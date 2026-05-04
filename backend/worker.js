// ============================================================
// Multi-tenant cron worker.
// All scheduled jobs iterate over active gyms and run inside withGym()
// so RLS scopes the queries to each tenant.
// ============================================================

const cron = require('node-cron');
const { query, withGym } = require('./db/db');

console.log('[Worker] Cron jobs initialized');

// gymId -> Set<telegramId> of members already notified today
const notifiedToday = new Map();
let lastNotifyDate = '';

const notificationMessages = {
  uz: {
    title: '⚠️ <b>Eslatma: Abonement tugamoqda!</b>',
    body: (name, days) => `Hurmatli <b>${name}</b>,\nAbonementingizda atiga <b>${days} mashg'ulot kuni</b> qolgan.\n\nUzluksiz mashg'ulot qilish uchun hoziroq yangilang! 💪`,
  },
  ru: {
    title: '⚠️ <b>Напоминание: Абонемент заканчивается!</b>',
    body: (name, days) => `Уважаемый(ая) <b>${name}</b>,\nВ вашем абонементе осталось всего <b>${days} дней тренировок</b>.\n\nОбновите сейчас для продолжения тренировок! 💪`,
  },
  kk: {
    title: '⚠️ <b>Еске салу: Абонемент аяқталуда!</b>',
    body: (name, days) => `Құрметті <b>${name}</b>,\nАбонементіңізде тек <b>${days} жаттығу күні</b> қалды.\n\nЖаттығуды жалғастыру үшін қазір жаңартыңыз! 💪`,
  },
  en: {
    title: '⚠️ <b>Reminder: Subscription expiring!</b>',
    body: (name, days) => `Dear <b>${name}</b>,\nYou have only <b>${days} training days</b> left on your subscription.\n\nRenew now to keep training! 💪`,
  },
};

async function listActiveGyms() {
  const r = await query(`SELECT id, slug FROM gyms WHERE is_active = true`);
  return r.rows;
}

// ─── Job 1: Expiring-soon notifications (9, 15, 21 Tashkent) ──
cron.schedule('0 9,15,21 * * *', async () => {
  console.log('[Worker] Expiry notifications…');

  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastNotifyDate) {
    notifiedToday.clear();
    lastNotifyDate = today;
  }

  const lock = await query('SELECT pg_try_advisory_lock(100001) AS got');
  if (!lock.rows[0].got) return;

  try {
    let bot;
    try { bot = require('./bot'); }
    catch (err) {
      console.error('[Worker] Bot module not available:', err.message);
      return;
    }

    const gyms = await listActiveGyms();
    let totalNotified = 0;

    for (const gym of gyms) {
      const seen = notifiedToday.get(gym.id) || new Set();
      let notifiedHere = 0;

      try {
        const expiring = await withGym(gym.id, async (db) => {
          const r = await db.query(`
            SELECT DISTINCT ON (m.telegram_id) m.telegram_id, m.first_name,
              (s.total_days - s.days_used) AS days_left
            FROM members m
            JOIN subscriptions s ON s.member_id = m.id
            WHERE s.status = 'active'
              AND (s.total_days - s.days_used) BETWEEN 1 AND 3
              AND m.telegram_id IS NOT NULL
              AND m.telegram_id > 0`);
          return r.rows;
        });

        for (const member of expiring) {
          if (seen.has(member.telegram_id)) continue;
          let memberLang = 'uz';
          try {
            memberLang = await withGym(gym.id, async (db) => {
              const r = await db.query(
                'SELECT value FROM settings WHERE key = $1',
                ['lang_' + member.telegram_id]
              );
              return r.rows.length > 0 ? r.rows[0].value : 'uz';
            });
          } catch {}
          const msg = notificationMessages[memberLang] || notificationMessages.uz;

          const sent = await bot.sendMessage(
            gym.id,
            member.telegram_id,
            `${msg.title}\n\n${msg.body(member.first_name, member.days_left)}`,
            { parse_mode: 'HTML' }
          );
          if (sent) {
            seen.add(member.telegram_id);
            notifiedHere++;
            totalNotified++;
          }
        }
      } catch (err) {
        console.error(`[Worker] gym=${gym.slug} expiry notify failed:`, err.message);
      }

      notifiedToday.set(gym.id, seen);
      if (notifiedHere > 0) {
        console.log(`[Worker] gym=${gym.slug} notified ${notifiedHere} (${seen.size} today)`);
      }
    }

    console.log(`[Worker] Total notified across gyms: ${totalNotified}`);
  } catch (err) {
    console.error('[Worker] Expiry job failed:', err.message);
  } finally {
    await query('SELECT pg_advisory_unlock(100001)');
  }
}, { timezone: 'Asia/Tashkent' });

// ─── Job 2: Auto-expire subscriptions (02:00 Tashkent) ────────
cron.schedule('0 2 * * *', async () => {
  console.log('[Worker] Auto-expire subscriptions…');
  const lock = await query('SELECT pg_try_advisory_lock(100002) AS got');
  if (!lock.rows[0].got) return;
  try {
    const gyms = await listActiveGyms();
    let total = 0;
    for (const gym of gyms) {
      try {
        const r = await withGym(gym.id, async (db) =>
          db.query(`UPDATE subscriptions SET status = 'expired'
                    WHERE status = 'active' AND (total_days - days_used) <= 0
                    RETURNING id`));
        total += r.rowCount;
      } catch (err) {
        console.error(`[Worker] gym=${gym.slug} expire failed:`, err.message);
      }
    }
    console.log(`[Worker] Expired ${total} subscriptions across all gyms`);
  } catch (err) {
    console.error('[Worker] Auto-expire failed:', err.message);
  } finally {
    await query('SELECT pg_advisory_unlock(100002)');
  }
}, { timezone: 'Asia/Tashkent' });

// ─── Job 3: Clean up stale entry codes (03:00 Tashkent) ───────
cron.schedule('0 3 * * *', async () => {
  console.log('[Worker] Entry-code cleanup…');
  const lock = await query('SELECT pg_try_advisory_lock(100003) AS got');
  if (!lock.rows[0].got) return;
  try {
    const gyms = await listActiveGyms();
    let total = 0;
    for (const gym of gyms) {
      try {
        const r = await withGym(gym.id, async (db) =>
          db.query(`DELETE FROM entry_codes WHERE valid_date < CURRENT_DATE`));
        total += r.rowCount;
      } catch (err) {
        console.error(`[Worker] gym=${gym.slug} entry-code cleanup failed:`, err.message);
      }
    }
    console.log(`[Worker] Cleaned ${total} old entry codes across all gyms`);
  } catch (err) {
    console.error('[Worker] Entry-code cleanup failed:', err.message);
  } finally {
    await query('SELECT pg_advisory_unlock(100003)');
  }
}, { timezone: 'Asia/Tashkent' });
