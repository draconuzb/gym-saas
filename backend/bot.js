// ============================================================
// Multi-tenant Telegram bot manager.
// Each gym in the `gyms` table with a non-null telegram_bot_token gets
// its own Telegraf instance. All bots share this code, but each one
// runs in the context of its own gym (gym_id propagated via ctx.gym).
// ============================================================

const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const { query, withGym } = require('./db/db');
const { makeQrToken } = require('./lib/qr');
const lang = require('./lib/lang');

// gymId -> Telegraf instance
const bots = new Map();
// `${gymId}:${telegramId}` -> 'uz'|'ru'|'kk'|'en'
const userLangCache = new Map();
// userId -> last payment-button click timestamp (5s cooldown)
const paymentCooldown = new Map();

const USE_WEBHOOK = process.env.BOT_USE_WEBHOOK === 'true';
const WEBHOOK_BASE = process.env.WEBHOOK_BASE || ''; // e.g. https://gym.bizdaoson.uz

// ─── Helpers ──────────────────────────────────────────────────

function langKey(gymId, telegramId) {
  return `${gymId}:${telegramId}`;
}

function setUserLang(gymId, telegramId, code) {
  if (userLangCache.size > 10000) userLangCache.clear();
  userLangCache.set(langKey(gymId, telegramId), code);
}

async function getLang(gymId, telegramId) {
  const cached = userLangCache.get(langKey(gymId, telegramId));
  if (cached) return cached;
  const code = await withGym(gymId, async (db) => {
    const r = await db.query('SELECT value FROM settings WHERE key = $1', ['lang_' + telegramId]);
    return r.rows.length > 0 ? r.rows[0].value : 'uz';
  }).catch(() => 'uz');
  setUserLang(gymId, telegramId, code);
  return code;
}

async function t(gymId, telegramId) {
  return lang[await getLang(gymId, telegramId)] || lang.uz;
}

function canPay(userId) {
  const last = paymentCooldown.get(userId);
  if (last && Date.now() - last < 5000) return false;
  paymentCooldown.set(userId, Date.now());
  if (paymentCooldown.size > 5000) paymentCooldown.clear();
  return true;
}

function formatPrice(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + " so'm";
}

function daysLeft(sub) {
  if (!sub) return 0;
  return Math.max(0, sub.total_days - sub.days_used);
}

function statusEmoji(left) {
  return left <= 0 ? '🔴' : left <= 3 ? '⚠️' : '✅';
}

// ─── Per-gym DB helpers (must run inside withGym) ─────────────

async function getMember(db, telegramId) {
  const r = await db.query(
    `SELECT m.*, COALESCE(p.name, 'none') AS plan
     FROM members m LEFT JOIN plans p ON p.id = m.plan_id
     WHERE m.telegram_id = $1`,
    [telegramId]
  );
  return r.rows[0] || null;
}

async function getActiveSub(db, memberId) {
  const r = await db.query(
    `SELECT * FROM subscriptions
     WHERE member_id = $1 AND status IN ('active', 'frozen')
     ORDER BY created_at DESC LIMIT 1`,
    [memberId]
  );
  const sub = r.rows[0] || null;
  if (sub && sub.status === 'active' && sub.visit_quota !== null && (sub.total_days - sub.days_used) <= 0) {
    return null;
  }
  return sub;
}

async function isAdmin(gymId, telegramId, envAdmins) {
  if (envAdmins && envAdmins.has(telegramId)) return true;
  return await withGym(gymId, async (db) => {
    const r = await db.query('SELECT 1 FROM bot_admins WHERE telegram_id = $1', [telegramId]);
    return r.rows.length > 0;
  }).catch(() => false);
}

async function getSetting(gymId, key, fallback = '') {
  return await withGym(gymId, async (db) => {
    const r = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
    return r.rows.length > 0 ? r.rows[0].value : fallback;
  }).catch(() => fallback);
}

async function getPlans(gymId) {
  return await withGym(gymId, async (db) => {
    const r = await db.query('SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC');
    return r.rows;
  }).catch(() => []);
}

// ─── Keyboards / Texts ────────────────────────────────────────

const SCAN_URL = (process.env.PUBLIC_BASE_URL || 'https://gym.bizdaoson.uz').replace(/\/+$/, '') + '/scan-checkin.html';

async function mainMenuKeyboard(gymId, telegramId) {
  const s = await t(gymId, telegramId);
  // Top row: Web App QR scanner — opens the in-Telegram camera so members
  // can check in by scanning the wall-poster QR without leaving the bot.
  // hearsAll handlers for Code/Qr stay registered for backward compatibility,
  // they just no longer have keyboard buttons.
  return Markup.keyboard([
    [Markup.button.webApp(s.menuScan, SCAN_URL)],
    [s.menuAccount, s.menuHistory],
    [s.menuBuy, s.menuContact],
    [s.menuRefresh, s.menuLang],
  ]).resize();
}

async function mainMenuText(gymId, m, sub, left, telegramId) {
  const s = await t(gymId, telegramId);
  const total = sub ? sub.total_days : 0;
  const barFilled = Math.min(left, 24);
  const barEmpty = Math.max(0, Math.min(total, 24) - barFilled);
  const progressBar = '🟩'.repeat(barFilled) + '⬜️'.repeat(barEmpty);
  const gymName = await getSetting(gymId, 'gym_name', 'GymSystem');
  return (
    `🏋️‍♂️ <b>${gymName}</b>\n\n` +
    `${s.mainMenuGreeting(m.first_name)}\n\n` +
    `${statusEmoji(left)} ${s.mainMenuSub(left, total)}\n` +
    `${progressBar}\n` +
    `${s.mainMenuPlan(m.plan)}\n\n` +
    (left <= 0 ? `${s.mainMenuExpired}\n\n` :
     left <= 3 ? `${s.mainMenuWarning(left)}\n\n` : '') +
    s.mainMenuChoose
  );
}

// ─── Bot factory ──────────────────────────────────────────────

/**
 * Build a Telegraf bot instance bound to a specific gym.
 * `gym` is a row from the `gyms` table (must include id, slug, telegram_bot_token).
 */
function createBotForGym(gym) {
  if (!gym.telegram_bot_token) {
    throw new Error(`Gym ${gym.slug} has no telegram_bot_token`);
  }
  const bot = new Telegraf(gym.telegram_bot_token);
  const gymId = gym.id;
  const envAdmins = new Set(); // env-level admins are no longer used per-gym

  // Attach gym to every ctx
  bot.use((ctx, next) => {
    ctx.gym = gym;
    ctx.gymId = gymId;
    return next();
  });

  // hearsAll: register a hears handler that matches all language variants
  function hearsAll(key, handler) {
    [lang.uz, lang.ru, lang.kk, lang.en].forEach(l => {
      if (l && l[key]) bot.hears(l[key], handler);
    });
  }

  // ─── Registration middleware ─────────────────────────────────
  bot.use(async (ctx, next) => {
    if (ctx.message && ctx.message.contact) return next();
    if (ctx.message && ctx.message.text === '/start') return next();
    const cbd = ctx.callbackQuery?.data || '';
    if (/^(buyp_|paycash_|payonline_|payinfo_|buy$|setlang_)/.test(cbd)) return next();

    const member = await withGym(gymId, (db) => getMember(db, ctx.from.id)).catch(() => null);
    if (!member) {
      const s = await t(gymId, ctx.from.id);
      if (ctx.callbackQuery) {
        return ctx.answerCbQuery(s.notRegisteredCb, { show_alert: true });
      }
      return ctx.reply(s.notRegisteredText);
    }
    ctx.state.member = member;
    ctx.state.sub = await withGym(gymId, (db) => getActiveSub(db, member.id)).catch(() => null);
    return next();
  });

  // ─── 📸 QR scanner Web App data ─────────────────────────────
  // Member taps the "menuScan" Web App button → in-Telegram camera page →
  // jsQR decodes the wall poster → tg.sendData() → arrives here as a
  // message with `web_app_data`. Only accept if the QR points at this
  // gym's bot (so a member can't scan a neighbouring gym's QR).
  bot.on('message', async (ctx, next) => {
    const wad = ctx.message && ctx.message.web_app_data;
    if (!wad) return next();
    const s = await t(gymId, ctx.from.id);
    const data = String(wad.data || '');

    // Wall poster encodes the bot's deep-link URL: t.me/<bot>?start=checkin
    const m = data.match(/t\.me\/([A-Za-z0-9_]+)\??start=checkin/i)
           || data.match(/t\.me\/([A-Za-z0-9_]+)\?start=checkin/i);
    if (!m) {
      return ctx.reply(s.scanInvalid);
    }
    const scannedUser = m[1].toLowerCase();
    const expectedUser = (gym.telegram_bot_username || '').toLowerCase();
    if (expectedUser && scannedUser !== expectedUser) {
      return ctx.reply(s.scanWrongGym(m[1], gym.telegram_bot_username));
    }

    const member = await withGym(gymId, (db) => getMember(db, ctx.from.id)).catch(() => null);
    return autoCheckin(ctx, member, s, gymId);
  });

  // ─── /start ───────────────────────────────────────────────────
  bot.start(async (ctx) => {
    const s = await t(gymId, ctx.from.id);

    if (ctx.startPayload === 'checkin') {
      const member = await withGym(gymId, (db) => getMember(db, ctx.from.id)).catch(() => null);
      return autoCheckin(ctx, member, s, gymId);
    }

    const member = await withGym(gymId, (db) => getMember(db, ctx.from.id)).catch(() => null);
    if (!member) {
      await ctx.reply(s.welcome, {
        parse_mode: 'HTML',
        ...Markup.keyboard([[Markup.button.contactRequest(s.sharePhoneBtn)]]).resize(),
      });
      return;
    }

    const sub = await withGym(gymId, (db) => getActiveSub(db, member.id)).catch(() => null);
    const left = daysLeft(sub);
    await ctx.replyWithHTML(
      await mainMenuText(gymId, member, sub, left, ctx.from.id),
      await mainMenuKeyboard(gymId, ctx.from.id)
    );
  });

  // ─── Contact registration ─────────────────────────────────────
  bot.on('contact', async (ctx) => {
    const contact = ctx.message.contact;
    if (contact.user_id !== ctx.from.id) {
      return ctx.reply("Iltimos, faqat o'zingizning telefon raqamingizni yuboring.");
    }
    const phone = contact.phone_number;
    const telegramId = ctx.from.id;
    const firstName = ctx.from.first_name || "A'zo";

    await withGym(gymId, async (db) => {
      const existing = await getMember(db, telegramId);
      if (existing) return;
      const phoneNormalized = phone.replace(/[^0-9+]/g, '');
      const byPhone = await db.query(
        `SELECT id FROM members WHERE phone = $1 AND telegram_id IS NULL`,
        [phoneNormalized]
      );
      if (byPhone.rows.length > 0) {
        await db.query(
          `UPDATE members SET telegram_id = $1, first_name = COALESCE(NULLIF($2, ''), first_name) WHERE id = $3`,
          [telegramId, firstName, byPhone.rows[0].id]
        );
      } else {
        await db.query(
          `INSERT INTO members (gym_id, telegram_id, first_name, phone)
           VALUES (current_gym_id(), $1, $2, $3)`,
          [telegramId, firstName, phoneNormalized]
        );
      }
    });

    const s = await t(gymId, telegramId);
    await ctx.reply(s.registered(firstName), {
      parse_mode: 'HTML',
      ...(await mainMenuKeyboard(gymId, telegramId)),
    });
  });

  // ─── 🔄 Refresh ───────────────────────────────────────────────
  hearsAll('menuRefresh', async (ctx) => {
    const { member, sub } = ctx.state;
    const left = daysLeft(sub);
    await ctx.replyWithHTML(
      await mainMenuText(gymId, member, sub, left, ctx.from.id),
      await mainMenuKeyboard(gymId, ctx.from.id)
    );
  });

  // ─── 🌐 Language switch ───────────────────────────────────────
  hearsAll('menuLang', async (ctx) => {
    const s = await t(gymId, ctx.from.id);
    await ctx.reply(s.langSwitchPrompt, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(s.langSwitchUz, 'setlang_uz'), Markup.button.callback(s.langSwitchRu, 'setlang_ru')],
        [Markup.button.callback(s.langSwitchKk, 'setlang_kk'), Markup.button.callback(s.langSwitchEn, 'setlang_en')],
      ]),
    });
  });

  ['uz', 'ru', 'kk', 'en'].forEach(code => {
    bot.action(`setlang_${code}`, async (ctx) => {
      setUserLang(gymId, ctx.from.id, code);
      await withGym(gymId, async (db) => {
        await db.query(
          `INSERT INTO settings (gym_id, key, value)
           VALUES (current_gym_id(), $1, $2)
           ON CONFLICT (gym_id, key) DO UPDATE SET value = EXCLUDED.value`,
          ['lang_' + ctx.from.id, code]
        );
      });
      await ctx.answerCbQuery(lang[code].langSwitched);
      const member = await withGym(gymId, (db) => getMember(db, ctx.from.id)).catch(() => null);
      if (member) {
        const sub = await withGym(gymId, (db) => getActiveSub(db, member.id)).catch(() => null);
        const left = daysLeft(sub);
        await ctx.editMessageText(lang[code].langSwitched, { parse_mode: 'HTML' });
        await ctx.reply(
          await mainMenuText(gymId, member, sub, left, ctx.from.id),
          { parse_mode: 'HTML', ...(await mainMenuKeyboard(gymId, ctx.from.id)) }
        );
      } else {
        await ctx.editMessageText(lang[code].langSwitched, { parse_mode: 'HTML' });
      }
    });
  });

  // ─── 🔑 Entry Code ────────────────────────────────────────────
  hearsAll('menuCode', async (ctx) => {
    const s = await t(gymId, ctx.from.id);
    const member = ctx.state.member;
    const sub = await withGym(gymId, (db) => getActiveSub(db, member.id)).catch(() => null);

    if (sub && sub.status === 'frozen') {
      return ctx.reply(s.frozenMsg, { parse_mode: 'HTML' });
    }
    const left = daysLeft(sub);
    if (left <= 0) {
      return ctx.reply(s.qrExpired, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback(s.qrBuyBtn, 'buy')]]),
      });
    }

    const code = await withGym(gymId, async (db) => {
      const existing = await db.query(
        `SELECT code FROM entry_codes
         WHERE member_id = $1 AND valid_date = CURRENT_DATE AND used = false
         ORDER BY created_at DESC LIMIT 1`,
        [member.id]
      );
      if (existing.rows.length > 0) return existing.rows[0].code;

      let attempts = 0;
      while (attempts < 10) {
        const c = String(Math.floor(100000 + Math.random() * 900000));
        try {
          await db.query(
            `INSERT INTO entry_codes (gym_id, member_id, code, valid_date)
             VALUES (current_gym_id(), $1, $2, CURRENT_DATE)`,
            [member.id, c]
          );
          return c;
        } catch (e) {
          attempts++;
        }
      }
      return null;
    });

    if (!code) return ctx.reply('❌ Kod yaratishda xatolik. Qayta urinib ko\'ring.');
    await ctx.reply(s.entryCodeMsg(code, left, member.first_name), { parse_mode: 'HTML' });
  });

  // ─── 🎫 QR Pass ───────────────────────────────────────────────
  hearsAll('menuQr', async (ctx) => {
    const { member, sub } = ctx.state;
    const left = daysLeft(sub);
    const s = await t(gymId, ctx.from.id);
    if (left <= 0) {
      return ctx.reply(s.qrExpired, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback(s.qrBuyBtn, 'buy')]]),
      });
    }
    const token = makeQrToken(gymId, ctx.from.id, gym.qr_hmac_secret);
    const qrBuffer = await QRCode.toBuffer(token, { width: 400, margin: 2 });
    await ctx.replyWithPhoto(
      { source: qrBuffer },
      { caption: `${statusEmoji(left)} ${s.qrCaption(member.first_name, left, member.plan)}`, parse_mode: 'HTML' }
    );
  });

  // ─── 📊 Account ───────────────────────────────────────────────
  hearsAll('menuAccount', async (ctx) => {
    const { member, sub } = ctx.state;
    const left = daysLeft(sub);
    const total = sub ? sub.total_days : 0;
    const used = sub ? sub.days_used : 0;
    const s = await t(gymId, ctx.from.id);
    const barFilled = Math.min(left, 24);
    const barEmpty = Math.max(0, Math.min(total, 24) - barFilled);
    const progressBar = '🟩'.repeat(barFilled) + '⬜️'.repeat(barEmpty);

    await ctx.reply(
      `${s.accountTitle}\n\n` +
      `${s.accountName(member.first_name)}\n` +
      `${s.accountPlan(member.plan)}\n\n` +
      `${s.accountTotal(total)}\n` +
      `${s.accountUsed(used)}\n` +
      `${s.accountLeft(left)}\n` +
      `${s.accountStatus(statusEmoji(left), left > 0 ? s.accountStatusActive : s.accountStatusExpired)}\n\n` +
      progressBar,
      { parse_mode: 'HTML' }
    );
  });

  // ─── 📅 History ───────────────────────────────────────────────
  hearsAll('menuHistory', async (ctx) => {
    const { member, sub } = ctx.state;
    const s = await t(gymId, ctx.from.id);

    const data = await withGym(gymId, async (db) => {
      const checkins = await db.query(
        `SELECT checked_in_at FROM checkins WHERE member_id = $1
         ORDER BY checked_in_at DESC LIMIT 10`,
        [member.id]
      );
      const totalVisits = await db.query(
        'SELECT COUNT(*) AS n FROM checkins WHERE member_id = $1',
        [member.id]
      );
      return { checkins: checkins.rows, total: totalVisits.rows[0].n };
    });

    const historyText = data.checkins.length === 0
      ? s.historyEmpty
      : data.checkins.map((c, i) =>
          `${i + 1}. ${new Date(c.checked_in_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`
        ).join('\n');

    const left = daysLeft(sub);
    await ctx.reply(
      `${s.historyTitle}\n\n${historyText}\n\n━━━━━━━━━━━━━━━━━━\n` +
      `${s.historyTotal(data.total)}\n${s.historyDaysLeft(left)}`,
      { parse_mode: 'HTML' }
    );
  });

  // ─── 💳 Buy subscription (dynamic plans) ──────────────────────
  const buyHandler = async (ctx) => {
    const plans = await getPlans(gymId);
    const s = await t(gymId, ctx.from.id);
    if (plans.length === 0) {
      const text = s.buyEmpty;
      if (ctx.callbackQuery) { await ctx.answerCbQuery(); return ctx.editMessageText(text, { parse_mode: 'HTML' }); }
      return ctx.reply(text, { parse_mode: 'HTML' });
    }
    let msg = `${s.buyTitle}\n\n${s.buyChoose}\n\n`;
    plans.forEach(p => {
      msg += `${p.emoji} <b>${p.name}</b> — ${formatPrice(p.price)} · ${p.days} ${s.buyDays}\n`;
      if (p.description) msg += `   <i>${p.description}</i>\n`;
    });
    const buttons = plans.map(p => [
      Markup.button.callback(`${p.emoji} ${p.name} — ${formatPrice(p.price)}`, `buyp_${p.id}`)
    ]);
    const kbd = { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) };
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
      await ctx.editMessageText(msg, kbd);
    } else {
      await ctx.reply(msg, kbd);
    }
  };

  hearsAll('menuBuy', buyHandler);
  bot.action('buy', buyHandler);

  // Plan selected → choose payment method
  bot.action(/^buyp_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const s = await t(gymId, ctx.from.id);
    const planId = parseInt(ctx.match[1]);
    const plan = await withGym(gymId, async (db) => {
      const r = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
      return r.rows[0] || null;
    }).catch(() => null);
    if (!plan) return ctx.editMessageText(s.payPlanNotFound);

    await ctx.editMessageText(
      `${s.payTitle}\n\n` +
      `${plan.emoji} ${s.payPlan}: <b>${plan.name}</b>\n` +
      `${s.payDuration(plan.days)}\n` +
      `${s.payPrice(formatPrice(plan.price))}\n` +
      (plan.description ? `📋 ${plan.description}\n` : '') +
      `\n${s.payChooseMethod}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback(s.payCash, `paycash_${planId}`)],
          [Markup.button.callback(s.payOnline, `payonline_${planId}`)],
          [Markup.button.callback(s.payBack, 'buy')],
        ]),
      }
    );
  });

  // Cash flow
  bot.action(/^paycash_(\d+)$/, async (ctx) => {
    if (!canPay(ctx.from.id)) return ctx.answerCbQuery('Iltimos, biroz kuting...');
    const s = await t(gymId, ctx.from.id);
    await ctx.answerCbQuery();

    const out = await withGym(gymId, async (db) => {
      const memberRes = await db.query(
        `SELECT id, first_name FROM members WHERE telegram_id = $1`, [ctx.from.id]);
      if (memberRes.rows.length === 0) return { notReg: true };
      const member = memberRes.rows[0];

      const planId = parseInt(ctx.match[1]);
      const planRes = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
      if (planRes.rows.length === 0) return { noPlan: true };
      const plan = planRes.rows[0];

      await db.query(
        `UPDATE subscriptions SET status = 'cancelled' WHERE member_id = $1 AND status = 'pending'`,
        [member.id]);
      await db.query(
        `UPDATE payments SET status = 'failed' WHERE member_id = $1 AND status = 'pending'`,
        [member.id]);

      const subResult = await db.query(
        `INSERT INTO subscriptions
           (gym_id, member_id, plan_id, plan_name, total_days, price, status,
            visit_quota, calendar_duration_months, allow_multi_entry_per_day)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, 'pending', $6, $7, $8) RETURNING id`,
        [member.id, plan.id, plan.name, plan.days, plan.price,
         plan.visit_quota ?? plan.days, plan.calendar_duration_months ?? 1, plan.allow_multi_entry_per_day === true]
      );
      const subId = subResult.rows[0].id;
      await db.query(
        `INSERT INTO payments (gym_id, member_id, subscription_id, amount, gateway, status)
         VALUES (current_gym_id(), $1, $2, $3, 'cash', 'pending')`,
        [member.id, subId, plan.price]);

      const adminsRes = await db.query('SELECT telegram_id FROM bot_admins');
      return {
        subId,
        member,
        plan,
        admins: adminsRes.rows.map(r => r.telegram_id),
      };
    }).catch(err => { console.error('[Bot] paycash error:', err.message); return null; });

    if (!out) return;
    if (out.notReg) return ctx.answerCbQuery(s.notRegisteredCb);
    if (out.noPlan) return ctx.answerCbQuery(s.payPlanNotFound);

    await ctx.editMessageText(s.cashCreated(out.subId), { parse_mode: 'HTML' });

    // Notify gym admins
    for (const adminId of out.admins) {
      bot.telegram.sendMessage(adminId,
        `💰 <b>Yangi to'lov so'rovi</b>\n\n` +
        `👤 ${out.member.first_name}\n` +
        `📦 ${out.plan.emoji} ${out.plan.name} — ${formatPrice(out.plan.price)}\n` +
        `💵 Naqd to'lov\n` +
        `📋 #${out.subId}\n\n` +
        `<i>Veb-paneldan tekshiring va tasdiqlang</i>`,
        { parse_mode: 'HTML' }
      ).catch(err => console.error(`[Bot ${gym.slug}] notify admin ${adminId}:`, err.message));
    }
  });

  // Online flow (Payme/Click placeholder — same structure as cash)
  bot.action(/^payonline_(\d+)$/, async (ctx) => {
    if (!canPay(ctx.from.id)) return ctx.answerCbQuery('Iltimos, biroz kuting...');
    const s = await t(gymId, ctx.from.id);
    await ctx.answerCbQuery();

    const out = await withGym(gymId, async (db) => {
      const memberRes = await db.query(
        `SELECT id, first_name FROM members WHERE telegram_id = $1`, [ctx.from.id]);
      if (memberRes.rows.length === 0) return { notReg: true };
      const member = memberRes.rows[0];

      const planId = parseInt(ctx.match[1]);
      const planRes = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
      if (planRes.rows.length === 0) return { noPlan: true };
      const plan = planRes.rows[0];

      await db.query(
        `UPDATE subscriptions SET status = 'cancelled' WHERE member_id = $1 AND status = 'pending'`,
        [member.id]);
      await db.query(
        `UPDATE payments SET status = 'failed' WHERE member_id = $1 AND status = 'pending'`,
        [member.id]);

      const subResult = await db.query(
        `INSERT INTO subscriptions
           (gym_id, member_id, plan_id, plan_name, total_days, price, status,
            visit_quota, calendar_duration_months, allow_multi_entry_per_day)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, 'pending', $6, $7, $8) RETURNING id`,
        [member.id, plan.id, plan.name, plan.days, plan.price,
         plan.visit_quota ?? plan.days, plan.calendar_duration_months ?? 1, plan.allow_multi_entry_per_day === true]
      );
      const subId = subResult.rows[0].id;
      await db.query(
        `INSERT INTO payments (gym_id, member_id, subscription_id, amount, gateway, status)
         VALUES (current_gym_id(), $1, $2, $3, 'payme', 'pending')`,
        [member.id, subId, plan.price]);

      const adminsRes = await db.query('SELECT telegram_id FROM bot_admins');
      return { subId, member, plan, admins: adminsRes.rows.map(r => r.telegram_id) };
    }).catch(err => { console.error('[Bot] payonline error:', err.message); return null; });

    if (!out) return;
    if (out.notReg) return ctx.answerCbQuery(s.notRegisteredCb);
    if (out.noPlan) return ctx.answerCbQuery(s.payPlanNotFound);

    await ctx.editMessageText(s.cashCreated(out.subId), { parse_mode: 'HTML' });

    for (const adminId of out.admins) {
      bot.telegram.sendMessage(adminId,
        `💰 <b>Yangi to'lov so'rovi</b>\n\n` +
        `👤 ${out.member.first_name}\n` +
        `📦 ${out.plan.emoji} ${out.plan.name} — ${formatPrice(out.plan.price)}\n` +
        `💳 Online to'lov\n` +
        `📋 #${out.subId}\n\n` +
        `<i>Veb-paneldan tekshiring va tasdiqlang</i>`,
        { parse_mode: 'HTML' }
      ).catch(err => console.error(`[Bot ${gym.slug}] notify admin ${adminId}:`, err.message));
    }
  });

  // ─── 📞 Contact ───────────────────────────────────────────────
  hearsAll('menuContact', async (ctx) => {
    const s = await t(gymId, ctx.from.id);
    const supportUser = await getSetting(gymId, 'support_username', '@gym_support_uz');
    const supportPhone = await getSetting(gymId, 'support_phone', '+998 90 000 00 00');
    await ctx.reply(
      `${s.contactTitle}\n\n${s.contactHours}\n${s.contactWeekdays}\n${s.contactSunday}\n\n` +
      `${s.contactTelegram(supportUser)}\n${s.contactPhone(supportPhone)}\n\n${s.contactNote}`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.url(s.contactWriteBtn, `https://t.me/${supportUser.replace('@', '')}`)],
        ]),
      }
    );
  });

  // ─── Fallback ─────────────────────────────────────────────────
  bot.on('text', async (ctx) => {
    if (!ctx.state.member) return;
    const s = await t(gymId, ctx.from.id);
    await ctx.replyWithHTML(s.fallback, await mainMenuKeyboard(gymId, ctx.from.id));
  });

  bot.on('message', async (ctx) => {
    if (!ctx.state?.member) return;
    const s = await t(gymId, ctx.from.id);
    await ctx.replyWithHTML(s.fallback || s.welcome, await mainMenuKeyboard(gymId, ctx.from.id));
  });

  // Error handler — keep the bot alive on per-update failures
  bot.catch((err, ctx) => {
    console.error(`[Bot ${gym.slug}] handler error:`, err.message);
  });

  return bot;
}

// ─── Auto check-in (poster QR) ────────────────────────────────

async function autoCheckin(ctx, member, s, gymId) {
  if (!member) {
    await ctx.reply(s.welcome, {
      parse_mode: 'HTML',
      ...Markup.keyboard([[Markup.button.contactRequest(s.sharePhoneBtn)]]).resize(),
    });
    return;
  }
  try {
    const out = await withGym(gymId, async (db) => {
      const subRes = await db.query(
        `SELECT id, total_days, days_used FROM subscriptions
         WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [member.id]
      );
      if (subRes.rows.length === 0) return { expired: true };
      const sub = subRes.rows[0];

      const todayRes = await db.query(
        `SELECT id FROM checkins WHERE member_id = $1 AND checked_in_at::date = CURRENT_DATE`,
        [member.id]
      );
      if (todayRes.rows.length > 0) {
        return { alreadyToday: true, left: sub.total_days - sub.days_used };
      }
      await db.query('UPDATE subscriptions SET days_used = days_used + 1 WHERE id = $1', [sub.id]);
      await db.query(
        `INSERT INTO checkins (gym_id, member_id, subscription_id, approved_by_staff)
         VALUES (current_gym_id(), $1, $2, false)`,
        [member.id, sub.id]
      );
      return { ok: true, left: sub.total_days - sub.days_used - 1 };
    });

    if (out.expired) {
      await ctx.reply(s.qrExpired, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback(s.qrBuyBtn || 'Sotib olish', 'buy')]]),
      });
      return;
    }
    if (out.alreadyToday) {
      await ctx.replyWithHTML(`✅ <b>Bugun allaqachon kirgansiz!</b>\n\n👤 ${member.first_name}\n⏳ Qolgan: <b>${out.left}</b> kun`);
      return;
    }
    const tail = out.left <= 0
      ? '⚠️ Abonement tugadi! Yangisini sotib oling.'
      : out.left <= 3
      ? `⚠️ Faqat <b>${out.left}</b> kun qoldi!`
      : 'Mashq muvaffaqiyatli o\'tsin! 💪';
    await ctx.replyWithHTML(`✅ <b>Davomat qabul qilindi!</b>\n\n👤 ${member.first_name}\n⏳ Qolgan: <b>${out.left}</b> kun\n\n${tail}`);
  } catch (err) {
    console.error('[Bot AutoCheckin] Error:', err.message);
    await ctx.reply('❌ Xatolik yuz berdi. Qayta urinib ko\'ring.');
  }
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Spin up a Telegraf bot for every active gym that has a token configured.
 * In webhook mode (BOT_USE_WEBHOOK=true), registers `/bot/:slug` on the
 * Express app for Telegram updates. In polling mode, calls bot.launch().
 */
async function startAllBots(app) {
  const result = await query(`
    SELECT id, slug, name, telegram_bot_token, telegram_bot_username, qr_hmac_secret, hardware_secret
    FROM gyms
    WHERE is_active = true AND telegram_bot_token IS NOT NULL
  `);

  if (result.rows.length === 0) {
    console.log('[Bot] No gyms with bot tokens found — skipping bot manager');
    return;
  }

  console.log(`[Bot] Starting ${result.rows.length} bot(s)...`);
  for (const gym of result.rows) {
    try {
      const bot = createBotForGym(gym);
      bots.set(gym.id, bot);

      if (USE_WEBHOOK && WEBHOOK_BASE && app) {
        const webhookPath = `/bot/${gym.slug}`;
        await bot.telegram.setWebhook(`${WEBHOOK_BASE}${webhookPath}`);
        app.use(webhookPath, bot.webhookCallback(webhookPath));
        console.log(`[Bot] gym=${gym.slug} webhook → ${WEBHOOK_BASE}${webhookPath}`);
      } else {
        bot.launch({ dropPendingUpdates: false }).catch(err => {
          console.error(`[Bot] gym=${gym.slug} launch failed:`, err.message);
        });
        console.log(`[Bot] gym=${gym.slug} polling started`);
      }
    } catch (err) {
      console.error(`[Bot] Failed to start bot for gym=${gym.slug}:`, err.message);
    }
  }

  process.once('SIGINT', () => stopAllBots('SIGINT'));
  process.once('SIGTERM', () => stopAllBots('SIGTERM'));
}

function stopAllBots(reason) {
  for (const [gymId, bot] of bots) {
    try { bot.stop(reason); } catch {}
  }
  bots.clear();
}

/**
 * Send a message via the gym's bot. Used by routes/payments.js to
 * notify the member when a payment is approved/rejected.
 */
async function sendMessage(gymId, telegramId, text, opts = {}) {
  const bot = bots.get(gymId);
  if (!bot) {
    console.warn(`[Bot] sendMessage called for gym ${gymId} but no bot is loaded`);
    return false;
  }
  try {
    await bot.telegram.sendMessage(telegramId, text, opts);
    return true;
  } catch (err) {
    console.error(`[Bot ${gymId}] sendMessage to ${telegramId} failed:`, err.message);
    return false;
  }
}

/**
 * Add or replace a bot at runtime — used when the super-admin creates
 * a new gym or rotates its token.
 */
async function reloadBotForGym(gymId) {
  const result = await query(
    `SELECT id, slug, name, is_active,
            telegram_bot_token, telegram_bot_username,
            qr_hmac_secret, hardware_secret
     FROM gyms WHERE id = $1`,
    [gymId]
  );
  if (result.rows.length === 0) return false;
  const gym = result.rows[0];

  // Stop the existing bot if any
  const old = bots.get(gymId);
  if (old) {
    try { old.stop('reload'); } catch {}
    bots.delete(gymId);
  }
  if (!gym.is_active || !gym.telegram_bot_token) return false;

  const bot = createBotForGym(gym);
  bots.set(gym.id, bot);
  if (USE_WEBHOOK && WEBHOOK_BASE) {
    await bot.telegram.setWebhook(`${WEBHOOK_BASE}/bot/${gym.slug}`);
  } else {
    bot.launch({ dropPendingUpdates: false }).catch(err =>
      console.error(`[Bot] reload gym=${gym.slug} launch failed:`, err.message));
  }

  // Backfill telegram_bot_username if missing (e.g. when the token was
  // inserted via raw SQL or before getMe was integrated).
  if (!gym.telegram_bot_username) {
    try {
      const me = await bot.telegram.getMe();
      if (me?.username) {
        await query(
          `UPDATE gyms SET telegram_bot_username = $1, updated_at = NOW() WHERE id = $2`,
          [me.username, gym.id]
        );
      }
    } catch (err) {
      console.warn(`[Bot] gym=${gym.slug} getMe failed for username backfill:`, err.message);
    }
  }
  return true;
}

/**
 * Returns true if a Telegraf instance is currently loaded for the given gym.
 * (Used by routes/gyms.js to surface bot status in the super-admin list.)
 */
function isBotRunning(gymId) {
  return bots.has(gymId);
}

module.exports = { startAllBots, stopAllBots, sendMessage, reloadBotForGym, isBotRunning };
