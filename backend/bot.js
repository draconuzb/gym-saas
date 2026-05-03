const { Telegraf, Markup } = require('telegraf');
const QRCode = require('qrcode');
const { query, getClient } = require('./db/db');
const { makeQrToken } = require('./lib/qr');
const lang = require('./lib/lang');

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ─── Language preference (in-memory) ─────────────────────────
const userLang = new Map();

// Prevent userLang from growing unbounded
function setUserLang(userId, lang) {
  if (userLang.size > 10000) userLang.clear();
  userLang.set(userId, lang);
}

// Payment button spam protection
const paymentCooldown = new Map();
function canPay(userId) {
  const last = paymentCooldown.get(userId);
  if (last && Date.now() - last < 5000) return false;
  paymentCooldown.set(userId, Date.now());
  if (paymentCooldown.size > 5000) paymentCooldown.clear();
  return true;
}

// (receipt photos removed — receipts are shown physically to manager)

async function getLang(telegramId) {
  if (userLang.has(telegramId)) return userLang.get(telegramId);
  const result = await query('SELECT value FROM settings WHERE key = $1', ['lang_' + telegramId]);
  const l = result.rows.length > 0 ? result.rows[0].value : 'uz';
  setUserLang(telegramId, l);
  return l;
}

async function t(telegramId) {
  return lang[await getLang(telegramId)];
}

/** Register a bot.hears handler that matches all 4 language button texts */
function hearsAll(key, handler) {
  [lang.uz, lang.ru, lang.kk, lang.en].forEach(l => {
    if (l[key]) bot.hears(l[key], handler);
  });
}

// ─── Admin whitelist from env + database ──────────────────────
const ENV_ADMINS = new Set(
  (process.env.BOT_ADMIN_IDS || '').split(',').filter(Boolean).map(Number)
);

async function isAdmin(telegramId) {
  if (ENV_ADMINS.has(telegramId)) return true;
  const result = await query('SELECT telegram_id FROM bot_admins WHERE telegram_id = $1', [telegramId]);
  return result.rows.length > 0;
}

// ─── Config helpers (from DB settings table) ──────────────────
async function getSetting(key, fallback = '') {
  const result = await query('SELECT value FROM settings WHERE key = $1', [key]);
  return result.rows.length > 0 ? result.rows[0].value : fallback;
}

async function setSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value]
  );
}

async function getPlans() {
  const result = await query('SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC');
  return result.rows;
}

function formatPrice(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') + " so'm";
}

// ─── Member helpers ───────────────────────────────────────────
async function getMember(telegramId) {
  const result = await query(
    `SELECT m.*, COALESCE(p.name, 'none') AS plan
     FROM members m LEFT JOIN plans p ON p.id = m.plan_id
     WHERE m.telegram_id = $1`,
    [telegramId]
  );
  return result.rows[0] || null;
}

async function getActiveSub(memberId) {
  // Include frozen subscriptions so the bot can display "frozen" status
  const result = await query(
    `SELECT * FROM subscriptions
     WHERE member_id = $1 AND status IN ('active', 'frozen')
     ORDER BY created_at DESC LIMIT 1`,
    [memberId]
  );
  const sub = result.rows[0] || null;
  // If active but all days used, treat as expired
  if (sub && sub.status === 'active' && sub.visit_quota !== null && (sub.total_days - sub.days_used) <= 0) {
    return null;
  }
  return sub;
}

function daysLeft(sub) {
  if (!sub) return 0;
  return Math.max(0, sub.total_days - sub.days_used);
}

function statusEmoji(left) {
  return left <= 0 ? '🔴' : left <= 3 ? '⚠️' : '✅';
}

// ─── Keyboards ────────────────────────────────────────────────
async function mainMenuKeyboard(telegramId) {
  const s = await t(telegramId);
  return Markup.keyboard([
    [s.menuCode, s.menuQr],
    [s.menuAccount, s.menuHistory],
    [s.menuBuy, s.menuContact],
    [s.menuRefresh, s.menuLang],
  ]).resize();
}

// ─── Registration middleware ──────────────────────────────────
bot.use(async (ctx, next) => {
  if (ctx.message && ctx.message.contact) return next();
  if (ctx.message && ctx.message.text === '/start') return next();

  // Allow admin approve/reject payment callbacks without member registration
  const cbd = ctx.callbackQuery?.data || '';
  if (/^(buyp_|paycash_|payonline_|payinfo_|buy$|setlang_)/.test(cbd)) return next();

  const m = await getMember(ctx.from.id);
  if (!m) {
    const s = await t(ctx.from.id);
    if (ctx.callbackQuery) {
      return ctx.answerCbQuery(s.notRegisteredCb, { show_alert: true });
    }
    return ctx.reply(s.notRegisteredText);
  }
  ctx.state.member = m;
  ctx.state.sub = await getActiveSub(m.id);
  return next();
});

// ─── /start ───────────────────────────────────────────────────
bot.start(async (ctx) => {
  const m = await getMember(ctx.from.id);
  const s = await t(ctx.from.id);

  // Wall-poster attendance QR (?start=checkin) — auto check-in & deduct day
  if (ctx.startPayload === 'checkin') {
    return autoCheckin(ctx, m, s);
  }

  if (!m) {
    await ctx.reply(s.welcome, {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        [Markup.button.contactRequest(s.sharePhoneBtn)],
      ]).resize(),
    });
    return;
  }

  const sub = await getActiveSub(m.id);
  const left = daysLeft(sub);
  await ctx.replyWithHTML(await mainMenuText(m, sub, left, ctx.from.id), await mainMenuKeyboard(ctx.from.id));
});

async function autoCheckin(ctx, m, s) {
  if (!m) {
    await ctx.reply(s.welcome, {
      parse_mode: 'HTML',
      ...Markup.keyboard([
        [Markup.button.contactRequest(s.sharePhoneBtn)],
      ]).resize(),
    });
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const subRes = await client.query(
      `SELECT id, total_days, days_used FROM subscriptions
       WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [m.id]
    );

    if (subRes.rows.length === 0) {
      await client.query('COMMIT');
      await ctx.reply(s.qrExpired, {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([[Markup.button.callback(s.qrBuyBtn || 'Sotib olish', 'buy')]]),
      });
      return;
    }

    const sub = subRes.rows[0];

    const todayRes = await client.query(
      `SELECT id FROM checkins WHERE member_id = $1 AND checked_in_at::date = CURRENT_DATE`,
      [m.id]
    );

    if (todayRes.rows.length > 0) {
      await client.query('COMMIT');
      const left = sub.total_days - sub.days_used;
      await ctx.replyWithHTML(`✅ <b>Bugun allaqachon kirgansiz!</b>\n\n👤 ${m.first_name}\n⏳ Qolgan: <b>${left}</b> kun`);
      return;
    }

    await client.query('UPDATE subscriptions SET days_used = days_used + 1 WHERE id = $1', [sub.id]);
    await client.query(
      'INSERT INTO checkins (member_id, subscription_id, approved_by_staff) VALUES ($1, $2, false)',
      [m.id, sub.id]
    );

    await client.query('COMMIT');

    const left = sub.total_days - sub.days_used - 1;
    const tail = left <= 0
      ? '⚠️ Abonement tugadi! Yangisini sotib oling.'
      : left <= 3
      ? `⚠️ Faqat <b>${left}</b> kun qoldi!`
      : 'Mashq muvaffaqiyatli o\'tsin! 💪';
    await ctx.replyWithHTML(`✅ <b>Davomat qabul qilindi!</b>\n\n👤 ${m.first_name}\n⏳ Qolgan: <b>${left}</b> kun\n\n${tail}`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('[Bot AutoCheckin] Error:', err.message);
    await ctx.reply('❌ Xatolik yuz berdi. Qayta urinib ko\'ring.');
  } finally {
    client.release();
  }
}

// ─── Contact registration ─────────────────────────────────────
bot.on('contact', async (ctx) => {
  const contact = ctx.message.contact;

  // Verify the shared contact belongs to the sender
  if (contact.user_id !== ctx.from.id) {
    return ctx.reply("Iltimos, faqat o'zingizning telefon raqamingizni yuboring.");
  }

  const phone = contact.phone_number;
  const telegramId = ctx.from.id;
  const firstName = ctx.from.first_name || "A'zo";

  const existingByTg = await getMember(telegramId);
  if (!existingByTg) {
    // Check if a member with this phone exists (imported from dashboard)
    const phoneNormalized = phone.replace(/[^0-9+]/g, '');
    const byPhone = await query(
      `SELECT * FROM members WHERE phone = $1 AND telegram_id IS NULL`,
      [phoneNormalized]
    );

    if (byPhone.rows.length > 0) {
      // Link existing member to this Telegram account
      await query(
        `UPDATE members SET telegram_id = $1, first_name = COALESCE(NULLIF($2, ''), first_name) WHERE id = $3`,
        [telegramId, firstName, byPhone.rows[0].id]
      );
    } else {
      // Create new member
      await query(
        `INSERT INTO members (telegram_id, first_name, phone)
         VALUES ($1, $2, $3)`,
        [telegramId, firstName, phone]
      );
    }
  }
  const s = await t(telegramId);
  await ctx.reply(s.registered(firstName), {
    parse_mode: 'HTML',
    ...(await mainMenuKeyboard(telegramId)),
  });
});

// ─── Main menu text ───────────────────────────────────────────
async function mainMenuText(m, sub, left, telegramId) {
  const s = await t(telegramId);
  const total = sub ? sub.total_days : 0;
  const barFilled = Math.min(left, 24);
  const barEmpty = Math.max(0, Math.min(total, 24) - barFilled);
  const progressBar = '🟩'.repeat(barFilled) + '⬜️'.repeat(barEmpty);

  return (
    `🏋️‍♂️ <b>GymSystem</b>\n\n` +
    `${s.mainMenuGreeting(m.first_name)}\n\n` +
    `${statusEmoji(left)} ${s.mainMenuSub(left, total)}\n` +
    `${progressBar}\n` +
    `${s.mainMenuPlan(m.plan)}\n\n` +
    (left <= 0 ? `${s.mainMenuExpired}\n\n` :
     left <= 3 ? `${s.mainMenuWarning(left)}\n\n` : '') +
    s.mainMenuChoose
  );
}

// ─── 🔄 Yangilash / Обновить ─────────────────────────────────
hearsAll('menuRefresh', async (ctx) => {
  const { member, sub } = ctx.state;
  const left = daysLeft(sub);
  await ctx.replyWithHTML(await mainMenuText(member, sub, left, ctx.from.id), await mainMenuKeyboard(ctx.from.id));
});

// ─── 🌐 Language switch ──────────────────────────────────────
hearsAll('menuLang', async (ctx) => {
  const s = await t(ctx.from.id);
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
    setUserLang(ctx.from.id, code);
    await query('INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2', ['lang_' + ctx.from.id, code]);
    await ctx.answerCbQuery(lang[code].langSwitched);
    const m = await getMember(ctx.from.id);
    if (m) {
      const sub = await getActiveSub(m.id);
      const left = daysLeft(sub);
      await ctx.editMessageText(lang[code].langSwitched, { parse_mode: 'HTML' });
      await ctx.reply(await mainMenuText(m, sub, left, ctx.from.id), {
        parse_mode: 'HTML',
        ...(await mainMenuKeyboard(ctx.from.id)),
      });
    } else {
      await ctx.editMessageText(lang[code].langSwitched, { parse_mode: 'HTML' });
    }
  });
});

// ─── 🔑 Entry Code (Kirish kodi) ─────────────────────────────
hearsAll('menuCode', async (ctx) => {
  const member = ctx.state.member || await getMember(ctx.from.id);
  if (!member) {
    const s = await t(ctx.from.id);
    return ctx.reply(s.notRegisteredText);
  }
  const sub = await getActiveSub(member.id);
  const s = await t(ctx.from.id);

  // Reject frozen subscriptions
  if (sub && sub.status === 'frozen') {
    await ctx.reply(s.frozenMsg, { parse_mode: 'HTML' });
    return;
  }

  const left = daysLeft(sub);

  if (left <= 0) {
    await ctx.reply(s.qrExpired, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback(s.qrBuyBtn, 'buy')]]),
    });
    return;
  }

  // Look for an UNUSED code for today (so member can retrieve the same code before scanning)
  const existing = await query(
    `SELECT code FROM entry_codes WHERE member_id = $1 AND valid_date = CURRENT_DATE AND used = false
     ORDER BY created_at DESC LIMIT 1`,
    [member.id]
  );

  let code;
  if (existing.rows.length > 0) {
    // Reuse pending unused code
    code = existing.rows[0].code;
  } else {
    // Generate a fresh unique 6-digit code (each kiosk scan burns one session)
    let attempts = 0;
    while (attempts < 10) {
      code = String(Math.floor(100000 + Math.random() * 900000));
      try {
        await query(
          `INSERT INTO entry_codes (member_id, code, valid_date) VALUES ($1, $2, CURRENT_DATE)`,
          [member.id, code]
        );
        break;
      } catch (e) {
        attempts++;
        if (attempts >= 10) code = null;
      }
    }
  }

  if (!code) {
    await ctx.reply('❌ Kod yaratishda xatolik. Qayta urinib ko\'ring.');
    return;
  }

  await ctx.reply(
    s.entryCodeMsg(code, left, member.first_name),
    { parse_mode: 'HTML' }
  );
});

// ─── 🎫 QR Pass ──────────────────────────────────────────────
hearsAll('menuQr', async (ctx) => {
  const { member, sub } = ctx.state;
  const left = daysLeft(sub);
  const s = await t(ctx.from.id);

  if (left <= 0) {
    await ctx.reply(s.qrExpired, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback(s.qrBuyBtn, 'buy')],
      ]),
    });
    return;
  }

  const token = makeQrToken(ctx.from.id);
  const qrBuffer = await QRCode.toBuffer(token, { width: 400, margin: 2 });

  await ctx.replyWithPhoto(
    { source: qrBuffer },
    {
      caption: `${statusEmoji(left)} ${s.qrCaption(member.first_name, left, member.plan)}`,
      parse_mode: 'HTML',
    }
  );
});

// ─── 📊 Mening hisobim / Мой аккаунт ────────────────────────
hearsAll('menuAccount', async (ctx) => {
  const { member, sub } = ctx.state;
  const left = daysLeft(sub);
  const total = sub ? sub.total_days : 0;
  const used = sub ? sub.days_used : 0;
  const s = await t(ctx.from.id);

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

// ─── 📅 Tashriflar tarixi / История посещений ────────────────
hearsAll('menuHistory', async (ctx) => {
  const { member, sub } = ctx.state;
  const s = await t(ctx.from.id);

  const checkins = await query(
    `SELECT checked_in_at FROM checkins WHERE member_id = $1
     ORDER BY checked_in_at DESC LIMIT 10`,
    [member.id]
  );

  let historyText;
  if (checkins.rows.length === 0) {
    historyText = s.historyEmpty;
  } else {
    historyText = checkins.rows
      .map((c, i) => `${i + 1}. ${new Date(c.checked_in_at).toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })}`)
      .join('\n');
  }

  const left = daysLeft(sub);
  const totalVisits = await query('SELECT COUNT(*) AS n FROM checkins WHERE member_id = $1', [member.id]);

  await ctx.reply(
    `${s.historyTitle}\n\n` +
    `${historyText}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n` +
    `${s.historyTotal(totalVisits.rows[0].n)}\n` +
    `${s.historyDaysLeft(left)}`,
    { parse_mode: 'HTML' }
  );
});

// ─── 💳 Abonement sotib olish (dynamic plans) ────────────────
const buyHandler = async (ctx) => {
  const plans = await getPlans();
  const s = await t(ctx.from.id);

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

// ─── Plan selected -> payment method ──────────────────────────
bot.action(/^buyp_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const s = await t(ctx.from.id);
  const planId = parseInt(ctx.match[1]);
  const planResult = await query('SELECT * FROM plans WHERE id = $1', [planId]);
  if (planResult.rows.length === 0) return ctx.editMessageText(s.payPlanNotFound);
  const plan = planResult.rows[0];

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
      // payCash = "I paid cash at the gym"
      // payOnline = "I paid online (Payme/Click)"
    }
  );
});

// ─── Cash payment -> "I paid cash at the gym" ────────────────
bot.action(/^paycash_(\d+)$/, async (ctx) => {
  if (!canPay(ctx.from.id)) {
    return ctx.answerCbQuery('Iltimos, biroz kuting...');
  }
  const s = await t(ctx.from.id);
  await ctx.answerCbQuery();
  const member = await getMember(ctx.from.id);
  if (!member) return ctx.answerCbQuery(s.notRegisteredCb);

  const planId = parseInt(ctx.match[1]);
  const planResult = await query('SELECT * FROM plans WHERE id = $1', [planId]);
  if (planResult.rows.length === 0) return ctx.answerCbQuery(s.payPlanNotFound);
  const plan = planResult.rows[0];

  // Cancel any previous pending subscriptions for this member
  await query(
    `UPDATE subscriptions SET status = 'cancelled' WHERE member_id = $1 AND status = 'pending'`,
    [member.id]
  );
  await query(
    `UPDATE payments SET status = 'failed' WHERE member_id = $1 AND status = 'pending'`,
    [member.id]
  );

  // Create pending subscription (with dynamic tariff snapshot) and payment
  const subResult = await query(
    `INSERT INTO subscriptions (member_id, plan_id, plan_name, total_days, price, status,
       visit_quota, calendar_duration_months, allow_multi_entry_per_day)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8) RETURNING id`,
    [member.id, plan.id, plan.name, plan.days, plan.price,
     plan.visit_quota ?? plan.days, plan.calendar_duration_months ?? 1, plan.allow_multi_entry_per_day === true]
  );
  const subId = subResult.rows[0].id;

  await query(
    `INSERT INTO payments (member_id, subscription_id, amount, gateway, status)
     VALUES ($1, $2, $3, 'cash', 'pending')`,
    [member.id, subId, plan.price]
  );

  await ctx.editMessageText(s.cashCreated(subId), { parse_mode: 'HTML' });

  // Notify admins (informational only, no approve/reject buttons)
  const dbAdmins = await query('SELECT telegram_id FROM bot_admins');
  const allAdminIds = [...ENV_ADMINS, ...dbAdmins.rows.map(r => r.telegram_id)];
  const uniqueAdmins = [...new Set(allAdminIds)];

  for (const adminId of uniqueAdmins) {
    bot.telegram.sendMessage(adminId,
      `💰 <b>Yangi to'lov so'rovi</b>\n\n` +
      `👤 ${member.first_name}\n` +
      `📦 ${plan.emoji} ${plan.name} — ${formatPrice(plan.price)}\n` +
      `💵 Naqd to'lov\n` +
      `📋 #${subId}\n\n` +
      `<i>Veb-paneldan tekshiring va tasdiqlang</i>`,
      { parse_mode: 'HTML' }
    ).catch(err => console.error(`[Bot] Failed to notify admin ${adminId}:`, err.message));
  }
});

// ─── Online payment -> "I paid online (Payme/Click)" ─────────
bot.action(/^payonline_(\d+)$/, async (ctx) => {
  if (!canPay(ctx.from.id)) {
    return ctx.answerCbQuery('Iltimos, biroz kuting...');
  }
  const s = await t(ctx.from.id);
  await ctx.answerCbQuery();
  const member = await getMember(ctx.from.id);
  if (!member) return ctx.answerCbQuery(s.notRegisteredCb);

  const planId = parseInt(ctx.match[1]);
  const planResult = await query('SELECT * FROM plans WHERE id = $1', [planId]);
  if (planResult.rows.length === 0) return ctx.answerCbQuery(s.payPlanNotFound);
  const plan = planResult.rows[0];

  // Cancel any previous pending subscriptions for this member
  await query(
    `UPDATE subscriptions SET status = 'cancelled' WHERE member_id = $1 AND status = 'pending'`,
    [member.id]
  );
  await query(
    `UPDATE payments SET status = 'failed' WHERE member_id = $1 AND status = 'pending'`,
    [member.id]
  );

  // Create pending subscription (with dynamic tariff snapshot)
  const subResult = await query(
    `INSERT INTO subscriptions (member_id, plan_id, plan_name, total_days, price, status,
       visit_quota, calendar_duration_months, allow_multi_entry_per_day)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8) RETURNING id`,
    [member.id, plan.id, plan.name, plan.days, plan.price,
     plan.visit_quota ?? plan.days, plan.calendar_duration_months ?? 1, plan.allow_multi_entry_per_day === true]
  );
  const subId = subResult.rows[0].id;

  await query(
    `INSERT INTO payments (member_id, subscription_id, amount, gateway, status)
     VALUES ($1, $2, $3, 'payme', 'pending')`,
    [member.id, subId, plan.price]
  );

  await ctx.editMessageText(s.cashCreated(subId), { parse_mode: 'HTML' });

  // Notify admins (informational only)
  const dbAdmins = await query('SELECT telegram_id FROM bot_admins');
  const allAdminIds = [...ENV_ADMINS, ...dbAdmins.rows.map(r => r.telegram_id)];
  const uniqueAdmins = [...new Set(allAdminIds)];

  for (const adminId of uniqueAdmins) {
    bot.telegram.sendMessage(adminId,
      `💰 <b>Yangi to'lov so'rovi</b>\n\n` +
      `👤 ${member.first_name}\n` +
      `📦 ${plan.emoji} ${plan.name} — ${formatPrice(plan.price)}\n` +
      `💳 Online to'lov\n` +
      `📋 #${subId}\n\n` +
      `<i>Veb-paneldan tekshiring va tasdiqlang</i>`,
      { parse_mode: 'HTML' }
    ).catch(err => console.error(`[Bot] Failed to notify admin ${adminId}:`, err.message));
  }
});

// Legacy approve_/reject_ inline handlers REMOVED.
// Payment approvals now happen exclusively from the web dashboard at /payments.
// Admin receives info-only Telegram notifications (no buttons).

// ─── 📞 Aloqa / Контакты ─────────────────────────────────────
hearsAll('menuContact', async (ctx) => {
  const s = await t(ctx.from.id);
  const supportUser = await getSetting('support_username', '@gym_support_uz');
  const supportPhone = await getSetting('support_phone', '+998 90 000 00 00');

  await ctx.reply(
    `${s.contactTitle}\n\n` +
    `${s.contactHours}\n` +
    `${s.contactWeekdays}\n` +
    `${s.contactSunday}\n\n` +
    `${s.contactTelegram(supportUser)}\n` +
    `${s.contactPhone(supportPhone)}\n\n` +
    `${s.contactNote}`,
    {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url(s.contactWriteBtn, `https://t.me/${supportUser.replace('@', '')}`)],
      ]),
    }
  );
});

// ─── Fallback: show menu for random text ──────────────────────
bot.on('text', async (ctx) => {
  if (!ctx.state.member) return;
  const s = await t(ctx.from.id);
  await ctx.replyWithHTML(s.fallback, await mainMenuKeyboard(ctx.from.id));
});

// Catch-all for non-text messages (stickers, photos, etc.)
bot.on('message', async (ctx) => {
  if (!ctx.state?.member) return;
  const s = await t(ctx.from.id);
  await ctx.replyWithHTML(s.fallback || s.welcome, await mainMenuKeyboard(ctx.from.id));
});

// ─── Launch ───────────────────────────────────────────────────
bot.launch({ dropPendingUpdates: false }).then(() => {
  console.log('[Bot] Telegram bot started');
}).catch(err => {
  console.error('[Bot] Failed to start:', err.message);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

module.exports = bot;
