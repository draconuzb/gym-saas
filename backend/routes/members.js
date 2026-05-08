const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const QRCode = require('qrcode');
const { query, withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');
const { makeQrToken, safeCompare } = require('../lib/qr');
const { normalizePhone } = require('../lib/phone');

// ─── Telegram-mini-app endpoints (no JWT) ─────────────────────
// These use the gym's qr_hmac_secret to validate an x-telegram-hash header.
// URL pattern: /api/members/telegram/:gym_slug/:telegramId

async function loadGymBySlug(slug) {
  const r = await query(
    'SELECT id, qr_hmac_secret FROM gyms WHERE slug = $1 AND is_active = true',
    [slug]
  );
  return r.rows[0] || null;
}

async function validateTelegramRequest(req, res, next) {
  const slug = req.params.gym_slug;
  const telegramId = req.params.telegramId;
  if (!slug || !telegramId) {
    return res.status(400).json({ success: false, message: 'gym_slug and telegramId are required.' });
  }
  const gym = await loadGymBySlug(slug);
  if (!gym) return res.status(404).json({ success: false, message: 'Gym not found.' });

  const tgHash = req.headers['x-telegram-hash'];
  if (!tgHash) return res.status(401).json({ success: false, message: 'x-telegram-hash header required.' });

  const expected = crypto
    .createHmac('sha256', gym.qr_hmac_secret)
    .update(String(telegramId))
    .digest('hex')
    .slice(0, 16);
  if (!safeCompare(tgHash, expected)) {
    return res.status(403).json({ success: false, message: 'Invalid telegram hash.' });
  }
  req.gymId = gym.id;
  req.gymSecrets = gym;
  next();
}

router.get('/telegram/:gym_slug/:telegramId', validateTelegramRequest, async (req, res) => {
  const { telegramId } = req.params;
  try {
    const out = await withGym(req.gymId, async (db) => {
      const memberResult = await db.query('SELECT * FROM members WHERE telegram_id = $1', [telegramId]);
      if (memberResult.rows.length === 0) return null;
      const member = memberResult.rows[0];
      const subResult = await db.query(
        `SELECT id, plan_id, plan_name, total_days, days_used, status, created_at, activated_at, expires_at
         FROM subscriptions WHERE member_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`,
        [member.id]
      );
      const subscription = subResult.rows[0] || null;
      const daysLeft = subscription ? Math.max(0, subscription.total_days - subscription.days_used) : 0;
      return { member, subscription, daysLeft };
    });
    if (!out) return res.status(404).json({ success: false, message: 'Member not found.' });
    const qrToken = makeQrToken(req.gymId, telegramId, req.gymSecrets.qr_hmac_secret);
    res.json({ success: true, data: { ...out.member, subscription: out.subscription, daysLeft: out.daysLeft, qrToken } });
  } catch (err) {
    console.error('[Members] Telegram lookup error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

router.get('/telegram/:gym_slug/:telegramId/qr', validateTelegramRequest, async (req, res) => {
  const { telegramId } = req.params;
  try {
    const exists = await withGym(req.gymId, async (db) => {
      const r = await db.query('SELECT id FROM members WHERE telegram_id = $1', [telegramId]);
      return r.rows.length > 0;
    });
    if (!exists) return res.status(404).json({ success: false, message: 'Member not found.' });

    const token = makeQrToken(req.gymId, telegramId, req.gymSecrets.qr_hmac_secret);
    const buffer = await QRCode.toBuffer(token, { type: 'png', width: 300, margin: 2 });
    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('[Members] QR generation error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// ─── Staff dashboard endpoints (require JWT + gym context) ────
router.use(authenticate, requireGym);

// GET all members (with active subscription summary, search, pagination)
router.get('/', async (req, res) => {
  const { search, status } = req.query;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;

  try {
    const out = await withGym(req.gymId, async (db) => {
      const fromClause = `
        FROM members m
        LEFT JOIN plans p ON p.id = m.plan_id
        LEFT JOIN LATERAL (
          SELECT total_days, days_used, status, expires_at
          FROM subscriptions
          WHERE member_id = m.id AND status = 'active'
          ORDER BY created_at DESC LIMIT 1
        ) s ON true`;
      const params = [];
      const conditions = [];
      if (search) {
        params.push(`%${search}%`);
        conditions.push(`(m.first_name ILIKE $${params.length} OR m.last_name ILIKE $${params.length} OR m.phone ILIKE $${params.length})`);
      }
      if (status === 'active') {
        conditions.push(`s.status = 'active' AND (s.total_days - s.days_used) > 0`);
      } else if (status === 'expired') {
        conditions.push(`(s.status IS NULL OR s.status != 'active' OR (s.total_days - s.days_used) <= 0)`);
      } else if (status === 'blocked') {
        conditions.push('m.is_active = false');
      }
      const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

      const countResult = await db.query(`SELECT COUNT(*) AS count ${fromClause}${whereClause}`, params);
      const total = parseInt(countResult.rows[0].count);

      const selectFields = `m.id, m.telegram_id, m.first_name, m.last_name, m.phone, m.plan_id, m.is_active, m.created_at,
          COALESCE(p.name, 'none') AS plan,
          s.total_days, s.days_used, s.status AS sub_status, s.expires_at`;
      const limitIdx = params.length + 1;
      const offsetIdx = params.length + 2;
      const sql = `SELECT ${selectFields} ${fromClause}${whereClause} ORDER BY m.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
      const result = await db.query(sql, [...params, limit, offset]);
      return { rows: result.rows, total };
    });
    res.json({ success: true, data: out.rows, total: out.total, page, limit });
  } catch (err) {
    console.error('[Members] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET single member with full profile
router.get('/:id', async (req, res) => {
  const memberId = parseInt(req.params.id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  try {
    const data = await withGym(req.gymId, async (db) => {
      const memberResult = await db.query(
        `SELECT m.id, m.telegram_id, m.first_name, m.last_name, m.phone, m.plan_id, m.is_active, m.created_at,
           COALESCE(p.name, 'none') AS plan
         FROM members m LEFT JOIN plans p ON p.id = m.plan_id
         WHERE m.id = $1`, [memberId]
      );
      if (memberResult.rows.length === 0) return null;
      const member = memberResult.rows[0];

      const [subResult, checkinsResult, paymentsResult, visitsResult] = await Promise.all([
        db.query(
          `SELECT id, plan_id, plan_name, total_days, days_used, status, created_at, activated_at, expires_at,
             frozen_at, frozen_days_saved, visit_quota, calendar_duration_months, allow_multi_entry_per_day
           FROM subscriptions WHERE member_id = $1 AND status IN ('active', 'frozen')
           ORDER BY created_at DESC LIMIT 1`, [memberId]),
        db.query(`SELECT checked_in_at FROM checkins WHERE member_id = $1 ORDER BY checked_in_at DESC LIMIT 10`, [memberId]),
        db.query(`SELECT id, amount, gateway, status, created_at FROM payments WHERE member_id = $1 ORDER BY created_at DESC LIMIT 10`, [memberId]),
        db.query(`SELECT COUNT(*) AS total FROM checkins WHERE member_id = $1`, [memberId]),
      ]);
      return {
        ...member,
        subscription: subResult.rows[0] || null,
        totalVisits: parseInt(visitsResult.rows[0].total),
        recentCheckins: checkinsResult.rows,
        payments: paymentsResult.rows,
      };
    });
    if (!data) return res.status(404).json({ success: false, message: 'Member not found.' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Members] Profile error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST register a new member (optionally with a starter subscription)
router.post('/register', async (req, res) => {
  const { firstName, lastName, planId, remainingDays, birthDate } = req.body;
  const phone = normalizePhone(req.body.phone);
  if (!firstName || !phone) {
    return res.status(400).json({ success: false, message: 'firstName and phone are required.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const existing = await db.query('SELECT id FROM members WHERE phone = $1', [phone]);
      if (existing.rows.length > 0) return { conflict: 'phone' };

      let validPlanId = null;
      let planRow = null;
      if (planId) {
        const planResult = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
        if (planResult.rows.length === 0) return { error: 'Plan not found' };
        validPlanId = planId;
        planRow = planResult.rows[0];
      }

      const result = await db.query(
        `INSERT INTO members (gym_id, first_name, last_name, phone, plan_id, birth_date)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5) RETURNING *`,
        [firstName, lastName || null, phone, validPlanId, birthDate || null]
      );
      const member = result.rows[0];

      if (validPlanId && remainingDays && remainingDays > 0) {
        const subResult = await db.query(
          `INSERT INTO subscriptions
             (gym_id, member_id, plan_id, plan_name, total_days, days_used, price, status, activated_at, expires_at,
              visit_quota, calendar_duration_months, allow_multi_entry_per_day)
           VALUES (current_gym_id(), $1, $2, $3, $4, 0, 0, 'active', NOW(), NOW() + make_interval(days => $5),
              $6, $7, $8) RETURNING id`,
          [
            member.id, validPlanId, planRow.name, remainingDays, remainingDays,
            planRow.visit_quota ?? remainingDays,
            planRow.calendar_duration_months ?? 1,
            planRow.allow_multi_entry_per_day === true,
          ]
        );
        await db.query(
          `INSERT INTO payments
             (gym_id, member_id, subscription_id, amount, gateway, status, processed_at, transaction_ref)
           VALUES (current_gym_id(), $1, $2, 0, 'cash', 'completed', NOW(), 'MIGRATED')`,
          [member.id, subResult.rows[0].id]
        );
      }
      return { member };
    });

    if (out.conflict === 'phone') {
      return res.status(409).json({ success: false, message: 'Member with this phone already exists.' });
    }
    if (out.error) {
      return res.status(400).json({ success: false, message: out.error });
    }
    res.status(201).json({ success: true, data: out.member });
  } catch (err) {
    console.error('[Members] Register error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT update member — admin only
router.put('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  const { firstName, lastName, isActive, birthDate } = req.body;
  const phone = normalizePhone(req.body.phone);
  try {
    const out = await withGym(req.gymId, async (db) => {
      const existing = await db.query('SELECT * FROM members WHERE id = $1', [memberId]);
      if (existing.rows.length === 0) return { notFound: true };
      const m = existing.rows[0];
      const newPhone = phone ?? m.phone;
      if (phone && phone !== m.phone) {
        const phoneCheck = await db.query('SELECT id FROM members WHERE phone = $1 AND id != $2', [phone, memberId]);
        if (phoneCheck.rows.length > 0) return { conflict: true };
      }
      const r = await db.query(
        `UPDATE members SET first_name = $1, last_name = $2, phone = $3, is_active = $4, birth_date = $5
         WHERE id = $6 RETURNING *`,
        [
          firstName ?? m.first_name,
          lastName ?? m.last_name,
          newPhone,
          isActive !== undefined ? isActive : m.is_active,
          birthDate !== undefined ? birthDate : m.birth_date,
          memberId,
        ]
      );
      return { member: r.rows[0] };
    });
    if (out.notFound) return res.status(404).json({ success: false, message: 'Member not found.' });
    if (out.conflict) return res.status(409).json({ success: false, message: 'Another member with this phone already exists.' });
    res.json({ success: true, data: out.member });
  } catch (err) {
    console.error('[Members] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE member + cascade — admin only
router.delete('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const existing = await db.query('SELECT id FROM members WHERE id = $1', [memberId]);
      if (existing.rows.length === 0) return { notFound: true };
      // RLS auto-scopes everything to current gym
      await db.query('DELETE FROM entry_codes WHERE member_id = $1', [memberId]);
      await db.query('DELETE FROM checkins WHERE member_id = $1', [memberId]);
      await db.query('DELETE FROM payments WHERE member_id = $1', [memberId]);
      await db.query('DELETE FROM class_enrollments WHERE member_id = $1', [memberId]);
      await db.query('DELETE FROM subscriptions WHERE member_id = $1', [memberId]);
      await db.query('DELETE FROM members WHERE id = $1', [memberId]);
      return { ok: true };
    });
    if (out.notFound) return res.status(404).json({ success: false, message: 'Member not found.' });
    res.json({ success: true });
  } catch (err) {
    console.error('[Members] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete member.' });
  }
});

// POST add days to active subscription — admin only
router.post('/:id/add-days', authorize('admin', 'super_admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  const { days } = req.body;
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  if (!days || days < 1 || days > 365) {
    return res.status(400).json({ success: false, message: 'Days must be between 1 and 365.' });
  }
  try {
    await withGym(req.gymId, async (db) => {
      const sub = await db.query(
        `SELECT id FROM subscriptions
         WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
         ORDER BY created_at DESC LIMIT 1`, [memberId]);
      if (sub.rows.length > 0) {
        await db.query('UPDATE subscriptions SET total_days = total_days + $1 WHERE id = $2', [days, sub.rows[0].id]);
      } else {
        await db.query(
          `INSERT INTO subscriptions
             (gym_id, member_id, plan_name, total_days, price, status, activated_at, expires_at,
              visit_quota, calendar_duration_months, allow_multi_entry_per_day)
           VALUES (current_gym_id(), $1, 'Manual', $2, 0, 'active', NOW(), NOW() + make_interval(days => $3),
              $4, 1, false)`,
          [memberId, days, days, days]
        );
      }
    });
    res.json({ success: true, message: `${days} days added.` });
  } catch (err) {
    console.error('[Members] Add days error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST freeze active subscription
router.post('/:id/freeze', authorize('admin', 'super_admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const sub = await db.query(
        `SELECT id, expires_at, total_days, days_used FROM subscriptions
         WHERE member_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`, [memberId]);
      if (sub.rows.length === 0) return { error: 'No active subscription to freeze.' };
      const s = sub.rows[0];
      let remainingDays;
      if (s.expires_at) {
        const remainingMs = new Date(s.expires_at) - new Date();
        remainingDays = Math.max(0, Math.ceil(remainingMs / 86400000));
      } else {
        remainingDays = Math.max(0, (s.total_days || 30) - (s.days_used || 0));
      }
      await db.query(
        `UPDATE subscriptions SET status = 'frozen', frozen_at = NOW(), frozen_days_saved = $1
         WHERE id = $2`,
        [remainingDays, s.id]);
      return { daysSaved: remainingDays };
    });
    if (out.error) return res.status(400).json({ success: false, message: out.error });
    res.json({ success: true, message: 'Subscription frozen.', daysSaved: out.daysSaved });
  } catch (err) {
    console.error('[Members] Freeze error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST unfreeze
router.post('/:id/unfreeze', authorize('admin', 'super_admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const sub = await db.query(
        `SELECT id, frozen_days_saved FROM subscriptions
         WHERE member_id = $1 AND status = 'frozen'
         ORDER BY created_at DESC LIMIT 1`, [memberId]);
      if (sub.rows.length === 0) return { error: 'No frozen subscription to unfreeze.' };
      const saved = sub.rows[0].frozen_days_saved || 0;
      await db.query(
        `UPDATE subscriptions SET status = 'active',
            expires_at = NOW() + ($1 * INTERVAL '1 day'),
            frozen_at = NULL, frozen_days_saved = 0
         WHERE id = $2`, [saved, sub.rows[0].id]);
      return { extendedDays: saved };
    });
    if (out.error) return res.status(400).json({ success: false, message: out.error });
    res.json({ success: true, message: 'Subscription reactivated.', extendedDays: out.extendedDays });
  } catch (err) {
    console.error('[Members] Unfreeze error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST remove days
router.post('/:id/remove-days', authorize('admin', 'super_admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  const { days } = req.body;
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  if (!days || days < 1) {
    return res.status(400).json({ success: false, message: 'Days must be at least 1.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const sub = await db.query(
        `SELECT id, total_days, days_used FROM subscriptions
         WHERE member_id = $1 AND status = 'active'
         ORDER BY created_at DESC LIMIT 1`, [memberId]);
      if (sub.rows.length === 0) return { error: 'No active subscription.' };
      const maxRemovable = sub.rows[0].total_days - sub.rows[0].days_used;
      const actual = Math.min(days, maxRemovable);
      await db.query('UPDATE subscriptions SET total_days = total_days - $1 WHERE id = $2', [actual, sub.rows[0].id]);
      return { actual };
    });
    if (out.error) return res.status(400).json({ success: false, message: out.error });
    res.json({ success: true, message: `${out.actual} days removed.` });
  } catch (err) {
    console.error('[Members] Remove days error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST subscribe member to a plan — admin only
router.post('/:id/subscribe', authorize('admin', 'super_admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  const { planId } = req.body;
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  if (!planId) {
    return res.status(400).json({ success: false, message: 'planId is required.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const member = await db.query('SELECT id FROM members WHERE id = $1 FOR UPDATE', [memberId]);
      if (member.rows.length === 0) return { status: 404, msg: 'Member not found.' };
      const plan = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
      if (plan.rows.length === 0) return { status: 404, msg: 'Plan not found.' };
      const existingSub = await db.query(
        `SELECT id FROM subscriptions WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0`,
        [memberId]);
      if (existingSub.rows.length > 0) return { status: 409, msg: 'Member already has an active subscription.' };

      const p = plan.rows[0];
      const sub = await db.query(
        `INSERT INTO subscriptions
           (gym_id, member_id, plan_id, plan_name, total_days, price, status, activated_at, expires_at,
            visit_quota, calendar_duration_months, allow_multi_entry_per_day)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, 'active', NOW(),
            NOW() + (COALESCE($6, 1) * INTERVAL '1 month'), $7, $6, $8) RETURNING *`,
        [memberId, p.id, p.name, p.days, p.price,
         p.calendar_duration_months ?? 1, p.visit_quota ?? p.days, p.allow_multi_entry_per_day === true]
      );
      await db.query(
        `INSERT INTO payments
           (gym_id, member_id, subscription_id, amount, gateway, status, processed_at)
         VALUES (current_gym_id(), $1, $2, $3, 'cash', 'completed', NOW())`,
        [memberId, sub.rows[0].id, p.price]
      );
      await db.query('UPDATE members SET plan_id = $1 WHERE id = $2', [p.id, memberId]);
      return { status: 201, sub: sub.rows[0] };
    });
    if (out.status !== 201) return res.status(out.status).json({ success: false, message: out.msg });
    res.status(201).json({ success: true, data: out.sub });
  } catch (err) {
    console.error('[Members] Subscribe error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST manual scan/check-in (dashboard)
router.post('/scan', async (req, res) => {
  const { memberId } = req.body;
  if (!memberId) return res.status(400).json({ success: false, message: 'memberId is required.' });
  try {
    const out = await withGym(req.gymId, async (db) => {
      const sub = await db.query(
        `SELECT id, total_days, days_used FROM subscriptions
         WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [memberId]);
      if (sub.rows.length === 0) return { status: 400, msg: 'No active subscription.' };

      const today = await db.query(
        `SELECT id FROM checkins WHERE member_id = $1 AND checked_in_at::date = CURRENT_DATE`,
        [memberId]);
      if (today.rows.length > 0) return { status: 409, msg: 'Already checked in today.' };

      await db.query('UPDATE subscriptions SET days_used = days_used + 1 WHERE id = $1', [sub.rows[0].id]);
      await db.query(
        `INSERT INTO checkins (gym_id, member_id, subscription_id, approved_by_staff)
         VALUES (current_gym_id(), $1, $2, true)`,
        [memberId, sub.rows[0].id]);
      return { status: 200 };
    });
    if (out.status !== 200) return res.status(out.status).json({ success: false, message: out.msg });
    res.json({ success: true, message: 'Check-in recorded.' });
  } catch (err) {
    console.error('[Members] Scan error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
