const cron = require('node-cron');
const { query } = require('./db/db');

console.log('[Worker] Cron jobs initialized');

// Track notified members to avoid duplicate notifications within the same day
const notifiedToday = new Set();
let lastNotifyDate = '';

// Notification messages per language
const notificationMessages = {
  uz: {
    title: '⚠️ <b>Eslatma: Abonement tugamoqda!</b>',
    body: (name, days) => `Hurmatli <b>${name}</b>,\nAbonementingizda atiga <b>${days} mashg'ulot kuni</b> qolgan.\n\nUzluksiz mashg'ulot qilish uchun hoziroq yangilang! 💪`
  },
  ru: {
    title: '⚠️ <b>Напоминание: Абонемент заканчивается!</b>',
    body: (name, days) => `Уважаемый(ая) <b>${name}</b>,\nВ вашем абонементе осталось всего <b>${days} дней тренировок</b>.\n\nОбновите сейчас для продолжения тренировок! 💪`
  },
  kk: {
    title: '⚠️ <b>Еске салу: Абонемент аяқталуда!</b>',
    body: (name, days) => `Құрметті <b>${name}</b>,\nАбонементіңізде тек <b>${days} жаттығу күні</b> қалды.\n\nЖаттығуды жалғастыру үшін қазір жаңартыңыз! 💪`
  },
  en: {
    title: '⚠️ <b>Reminder: Subscription expiring!</b>',
    body: (name, days) => `Dear <b>${name}</b>,\nYou have only <b>${days} training days</b> left on your subscription.\n\nRenew now to keep training! 💪`
  }
};

// Run at 9 AM, 3 PM, and 9 PM Tashkent time to retry failed notifications
cron.schedule('0 9,15,21 * * *', async () => {
  console.log('[Worker] Running subscription expiry notification check...');

  // Reset daily tracking set at the start of a new day
  const today = new Date().toISOString().slice(0, 10);
  if (today !== lastNotifyDate) {
    notifiedToday.clear();
    lastNotifyDate = today;
  }

  const lockResult = await query("SELECT pg_try_advisory_lock(100001)");
  if (!lockResult.rows[0].pg_try_advisory_lock) return;
  try {
    // Find members whose subscriptions expire within 3 days
    const result = await query(`
      SELECT DISTINCT ON (m.telegram_id) m.telegram_id, m.first_name, (s.total_days - s.days_used) AS days_left
      FROM members m
      JOIN subscriptions s ON s.member_id = m.id
      WHERE s.status = 'active'
        AND (s.total_days - s.days_used) BETWEEN 1 AND 3
        AND m.telegram_id > 0
    `);

    if (result.rows.length === 0) {
      console.log('[Worker] No expiring subscriptions found');
      return;
    }

    // Lazy-load bot only when needed (bot.js exports the Telegraf instance)
    let bot;
    try {
      bot = require('./bot');
    } catch (err) {
      console.error('[Worker] Bot not available for notifications:', err.message);
      return;
    }

    let notifiedCount = 0;
    for (const member of result.rows) {
      // Skip members already notified today
      if (notifiedToday.has(member.telegram_id)) continue;

      try {
        // Look up member language preference from settings table
        const langResult = await query(
          "SELECT value FROM settings WHERE key = $1",
          ['lang_' + member.telegram_id]
        );
        const lang = langResult.rows.length > 0 ? langResult.rows[0].value : 'uz';
        const msg = notificationMessages[lang] || notificationMessages.uz;

        await bot.telegram.sendMessage(
          member.telegram_id,
          `${msg.title}\n\n${msg.body(member.first_name, member.days_left)}`,
          { parse_mode: 'HTML' }
        );
        notifiedToday.add(member.telegram_id);
        notifiedCount++;
      } catch (err) {
        console.error(`[Worker] Failed to notify ${member.first_name}:`, err.message);
      }
    }

    console.log(`[Worker] Notified ${notifiedCount} members about expiring subs (${notifiedToday.size} total today)`);
  } catch (err) {
    console.error('[Worker] Daily check failed:', err.message);
  } finally {
    await query("SELECT pg_advisory_unlock(100001)");
  }
}, { timezone: 'Asia/Tashkent' });

// Auto-expire subscriptions where all days are used
cron.schedule('0 2 * * *', async () => {
  console.log('[Worker] Running subscription auto-expire...');
  const lockResult = await query("SELECT pg_try_advisory_lock(100002)");
  if (!lockResult.rows[0].pg_try_advisory_lock) return;
  try {
    const result = await query(`
      UPDATE subscriptions SET status = 'expired'
      WHERE status = 'active' AND (total_days - days_used) <= 0
      RETURNING id
    `);
    console.log(`[Worker] Expired ${result.rowCount} subscriptions`);
  } catch (err) {
    console.error('[Worker] Auto-expire failed:', err.message);
  } finally {
    await query("SELECT pg_advisory_unlock(100002)");
  }
}, { timezone: 'Asia/Tashkent' });

// Clean up old entry codes daily at 3 AM
cron.schedule('0 3 * * *', async () => {
  console.log('[Worker] Cleaning up old entry codes...');
  const lockResult = await query("SELECT pg_try_advisory_lock(100003)");
  if (!lockResult.rows[0].pg_try_advisory_lock) return;
  try {
    const result = await query(`DELETE FROM entry_codes WHERE valid_date < CURRENT_DATE`);
    console.log(`[Worker] Cleaned ${result.rowCount} old entry codes`);
  } catch (err) {
    console.error('[Worker] Entry code cleanup failed:', err.message);
  } finally {
    await query("SELECT pg_advisory_unlock(100003)");
  }
}, { timezone: 'Asia/Tashkent' });
