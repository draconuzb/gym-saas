#!/usr/bin/env node
// ============================================================
// One-shot migration: copy data from the old single-tenant
// onson-gym Postgres into the new multi-tenant gym-saas schema
// as gym_id=1 (slug "onson").
//
// Usage:
//   node migrate-from-v1.js --source 'postgres://user:pwd@host:5432/old_db' \
//                           --target 'postgres://user:pwd@host:5432/new_db' \
//                           --slug onson --name "Onson Gym"
//
// Or set env vars:
//   SRC_PG=postgres://...   TGT_PG=postgres://...   GYM_SLUG=onson
// ============================================================

const { Pool } = require('pg');
const crypto = require('crypto');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[name.toUpperCase().replace(/-/g, '_')] ?? fallback;
}

const SRC = arg('source', process.env.SRC_PG);
const TGT = arg('target', process.env.TGT_PG);
const SLUG = arg('slug', process.env.GYM_SLUG || 'onson');
const NAME = arg('name', process.env.GYM_NAME || 'Onson Gym');
const TG_TOKEN = arg('telegram-token', process.env.GYM_TELEGRAM_TOKEN || null);
const TG_USERNAME = arg('telegram-username', process.env.GYM_TELEGRAM_USERNAME || null);

if (!SRC || !TGT) {
  console.error('Usage: node migrate-from-v1.js --source <src_pg_url> --target <tgt_pg_url> [--slug onson] [--name "Onson Gym"]');
  process.exit(1);
}

const src = new Pool({ connectionString: SRC, max: 5 });
const tgt = new Pool({ connectionString: TGT, max: 5 });

function genSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

async function migrate() {
  // 1. Sanity-check both databases
  const srcVer = await src.query('SELECT version()');
  const tgtVer = await tgt.query('SELECT version()');
  console.log('[Migrate] source:', srcVer.rows[0].version.split(',')[0]);
  console.log('[Migrate] target:', tgtVer.rows[0].version.split(',')[0]);

  // Confirm target is the new schema (must have gyms table)
  const hasGyms = await tgt.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gyms'`
  );
  if (hasGyms.rows.length === 0) {
    throw new Error('Target DB does not have the new schema — run schema.sql first');
  }

  // 2. Create / find the destination gym
  const tgtClient = await tgt.connect();
  let gymId;
  try {
    await tgtClient.query('BEGIN');

    const existing = await tgtClient.query('SELECT id FROM gyms WHERE slug = $1', [SLUG]);
    if (existing.rows.length > 0) {
      gymId = existing.rows[0].id;
      console.log(`[Migrate] gym ${SLUG} already exists with id=${gymId}`);
    } else {
      const r = await tgtClient.query(
        `INSERT INTO gyms (slug, name, telegram_bot_token, telegram_bot_username,
                           qr_hmac_secret, hardware_secret)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [SLUG, NAME, TG_TOKEN, TG_USERNAME, genSecret(32), genSecret(32)]
      );
      gymId = r.rows[0].id;
      console.log(`[Migrate] created gym ${SLUG} with id=${gymId}`);
    }

    await tgtClient.query('SELECT set_config($1, $2, true)', ['app.current_gym_id', String(gymId)]);

    // 3. Migrate users (staff). Old users have NO gym_id; we set it to gymId.
    //    Skip super_admins (they don't exist in the old DB anyway).
    console.log('[Migrate] users…');
    const oldUsers = await src.query(
      `SELECT id, phone, password_hash, role, first_name, last_name, created_at FROM users`
    );
    for (const u of oldUsers.rows) {
      await tgtClient.query(
        `INSERT INTO users (gym_id, phone, password_hash, role, first_name, last_name, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING`,
        [gymId, u.phone, u.password_hash, u.role, u.first_name, u.last_name, u.created_at]
      );
    }
    console.log(`  → ${oldUsers.rows.length} users`);

    // We need ID-mapping tables: old_id → new_id, because the new schema
    // uses fresh SERIAL ids for plans/members/etc. Build maps as we go.
    const planMap = new Map();
    const memberMap = new Map();
    const subscriptionMap = new Map();
    const trainerMap = new Map();
    const classMap = new Map();
    const userPhoneMap = new Map();

    // Build user phone → new id for FK references (approved_by, registered_by)
    const newUsers = await tgtClient.query('SELECT id, phone FROM users WHERE gym_id = $1', [gymId]);
    for (const u of newUsers.rows) userPhoneMap.set(u.phone, u.id);
    const oldUserMap = new Map();
    for (const u of oldUsers.rows) {
      const newId = userPhoneMap.get(u.phone);
      if (newId) oldUserMap.set(u.id, newId);
    }

    // 4. plans
    console.log('[Migrate] plans…');
    const oldPlans = await src.query(`SELECT * FROM plans ORDER BY id`);
    for (const p of oldPlans.rows) {
      const r = await tgtClient.query(
        `INSERT INTO plans (gym_id, name, emoji, price, days, visit_quota,
            calendar_duration_months, allow_multi_entry_per_day,
            description, is_active, sort_order, created_at)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [p.name, p.emoji, p.price, p.days, p.visit_quota,
         p.calendar_duration_months, p.allow_multi_entry_per_day,
         p.description, p.is_active, p.sort_order, p.created_at]
      );
      planMap.set(p.id, r.rows[0].id);
    }
    console.log(`  → ${oldPlans.rows.length} plans`);

    // 5. trainers
    console.log('[Migrate] trainers…');
    const oldTrainers = await src.query(`SELECT * FROM trainers ORDER BY id`);
    for (const t of oldTrainers.rows) {
      const r = await tgtClient.query(
        `INSERT INTO trainers (gym_id, first_name, last_name, specialty, phone, is_active, created_at)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6) RETURNING id`,
        [t.first_name, t.last_name, t.specialty, t.phone, t.is_active, t.created_at]
      );
      trainerMap.set(t.id, r.rows[0].id);
    }
    console.log(`  → ${oldTrainers.rows.length} trainers`);

    // 6. members
    console.log('[Migrate] members…');
    const oldMembers = await src.query(`SELECT * FROM members ORDER BY id`);
    for (const m of oldMembers.rows) {
      const r = await tgtClient.query(
        `INSERT INTO members (gym_id, telegram_id, first_name, last_name, phone,
            plan_id, is_active, birth_date, created_at)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [m.telegram_id, m.first_name, m.last_name, m.phone,
         m.plan_id ? planMap.get(m.plan_id) : null,
         m.is_active, m.birth_date, m.created_at]
      );
      memberMap.set(m.id, r.rows[0].id);
    }
    console.log(`  → ${oldMembers.rows.length} members`);

    // 7. subscriptions
    console.log('[Migrate] subscriptions…');
    const oldSubs = await src.query(`SELECT * FROM subscriptions ORDER BY id`);
    for (const s of oldSubs.rows) {
      const newMemberId = memberMap.get(s.member_id);
      if (!newMemberId) continue;
      const r = await tgtClient.query(
        `INSERT INTO subscriptions (gym_id, member_id, plan_id, plan_name, total_days,
            days_used, visit_quota, calendar_duration_months, allow_multi_entry_per_day,
            price, status, approved_by, frozen_at, frozen_days_saved,
            created_at, activated_at, expires_at)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                 $11, $12, $13, $14, $15, $16) RETURNING id`,
        [newMemberId, s.plan_id ? planMap.get(s.plan_id) : null, s.plan_name, s.total_days,
         s.days_used, s.visit_quota, s.calendar_duration_months, s.allow_multi_entry_per_day,
         s.price, s.status, s.approved_by ? oldUserMap.get(s.approved_by) : null,
         s.frozen_at, s.frozen_days_saved, s.created_at, s.activated_at, s.expires_at]
      );
      subscriptionMap.set(s.id, r.rows[0].id);
    }
    console.log(`  → ${oldSubs.rows.length} subscriptions`);

    // 8. checkins
    console.log('[Migrate] checkins…');
    const oldCheckins = await src.query(`SELECT * FROM checkins ORDER BY id`);
    let checkinsImported = 0;
    for (const c of oldCheckins.rows) {
      const newMemberId = memberMap.get(c.member_id);
      if (!newMemberId) continue;
      await tgtClient.query(
        `INSERT INTO checkins (gym_id, member_id, subscription_id, checked_in_at, approved_by_staff)
         VALUES (current_gym_id(), $1, $2, $3, $4)`,
        [newMemberId, c.subscription_id ? subscriptionMap.get(c.subscription_id) : null,
         c.checked_in_at, c.approved_by_staff]
      );
      checkinsImported++;
    }
    console.log(`  → ${checkinsImported}/${oldCheckins.rows.length} checkins`);

    // 9. payments
    console.log('[Migrate] payments…');
    const oldPayments = await src.query(`SELECT * FROM payments ORDER BY id`);
    let paymentsImported = 0;
    for (const p of oldPayments.rows) {
      const newMemberId = memberMap.get(p.member_id);
      if (!newMemberId) continue;
      await tgtClient.query(
        `INSERT INTO payments (gym_id, member_id, subscription_id, amount, gateway,
            status, transaction_ref, receipt_url, processed_at, created_at)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [newMemberId, p.subscription_id ? subscriptionMap.get(p.subscription_id) : null,
         p.amount, p.gateway, p.status, p.transaction_ref, p.receipt_url,
         p.processed_at, p.created_at]
      );
      paymentsImported++;
    }
    console.log(`  → ${paymentsImported}/${oldPayments.rows.length} payments`);

    // 10. classes (depends on trainerMap)
    console.log('[Migrate] classes…');
    const oldClasses = await src.query(`SELECT * FROM classes ORDER BY id`);
    for (const c of oldClasses.rows) {
      const r = await tgtClient.query(
        `INSERT INTO classes (gym_id, name, trainer_id, day_of_week, start_time, capacity, created_at)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6) RETURNING id`,
        [c.name, c.trainer_id ? trainerMap.get(c.trainer_id) : null,
         c.day_of_week, c.start_time, c.capacity, c.created_at]
      );
      classMap.set(c.id, r.rows[0].id);
    }
    console.log(`  → ${oldClasses.rows.length} classes`);

    // 11. class_enrollments
    console.log('[Migrate] class_enrollments…');
    const oldEnroll = await src.query(`SELECT * FROM class_enrollments ORDER BY id`);
    let enrollImported = 0;
    for (const e of oldEnroll.rows) {
      const newClassId = classMap.get(e.class_id);
      const newMemberId = memberMap.get(e.member_id);
      if (!newClassId || !newMemberId) continue;
      await tgtClient.query(
        `INSERT INTO class_enrollments (gym_id, class_id, member_id, enrolled_at)
         VALUES (current_gym_id(), $1, $2, $3) ON CONFLICT DO NOTHING`,
        [newClassId, newMemberId, e.enrolled_at]
      );
      enrollImported++;
    }
    console.log(`  → ${enrollImported}/${oldEnroll.rows.length} class_enrollments`);

    // 12. bot_admins
    console.log('[Migrate] bot_admins…');
    const oldBotAdmins = await src.query(`SELECT * FROM bot_admins`);
    for (const b of oldBotAdmins.rows) {
      await tgtClient.query(
        `INSERT INTO bot_admins (gym_id, telegram_id, added_at)
         VALUES (current_gym_id(), $1, $2) ON CONFLICT DO NOTHING`,
        [b.telegram_id, b.added_at]
      );
    }
    console.log(`  → ${oldBotAdmins.rows.length} bot_admins`);

    // 13. settings (skip lang_<id> rows because they grow unbounded)
    console.log('[Migrate] settings…');
    const oldSettings = await src.query(`SELECT * FROM settings`);
    for (const s of oldSettings.rows) {
      await tgtClient.query(
        `INSERT INTO settings (gym_id, key, value)
         VALUES (current_gym_id(), $1, $2)
         ON CONFLICT (gym_id, key) DO UPDATE SET value = EXCLUDED.value`,
        [s.key, s.value]
      );
    }
    console.log(`  → ${oldSettings.rows.length} settings`);

    // 14. daily_visits
    console.log('[Migrate] daily_visits…');
    const oldDaily = await src.query(`SELECT * FROM daily_visits ORDER BY id`);
    for (const d of oldDaily.rows) {
      await tgtClient.query(
        `INSERT INTO daily_visits (gym_id, visitor_name, phone, amount, payment_method,
            notes, visited_at, registered_by)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6, $7)`,
        [d.visitor_name, d.phone, d.amount, d.payment_method, d.notes, d.visited_at,
         d.registered_by ? oldUserMap.get(d.registered_by) : null]
      );
    }
    console.log(`  → ${oldDaily.rows.length} daily_visits`);

    // 15. entry_codes — skip stale (older than today)
    console.log('[Migrate] entry_codes (today only)…');
    const oldEntryCodes = await src.query(
      `SELECT * FROM entry_codes WHERE valid_date >= CURRENT_DATE`
    );
    for (const e of oldEntryCodes.rows) {
      const newMemberId = memberMap.get(e.member_id);
      if (!newMemberId) continue;
      await tgtClient.query(
        `INSERT INTO entry_codes (gym_id, member_id, code, valid_date, used, created_at)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [newMemberId, e.code, e.valid_date, e.used, e.created_at]
      );
    }
    console.log(`  → ${oldEntryCodes.rows.length} entry_codes`);

    await tgtClient.query('COMMIT');
    console.log(`\n✅ Migration completed for gym_id=${gymId} (slug=${SLUG})`);
  } catch (err) {
    await tgtClient.query('ROLLBACK').catch(() => {});
    console.error('\n❌ Migration FAILED:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    tgtClient.release();
    await src.end();
    await tgt.end();
  }
}

migrate().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
