const express = require('express');
const router = express.Router();
const { query, withGym } = require('../db/db');
const { authenticate, requireGym } = require('../middleware/auth');
const { verifyQrToken, safeCompare } = require('../lib/qr');

const codeAttempts = new Map();
const CODE_RATE_WINDOW = 5 * 60 * 1000;
const CODE_MAX_ATTEMPTS = 30;  // shared across kiosks of all gyms — keep generous

function codeRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const attempts = codeAttempts.get(ip);
  if (attempts) {
    if (now - attempts.firstAttempt > CODE_RATE_WINDOW) {
      codeAttempts.delete(ip);
    } else if (attempts.count >= CODE_MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many attempts. Try again later.' });
    }
  }
  const entry = codeAttempts.get(ip) || { count: 0, firstAttempt: now };
  entry.count++;
  codeAttempts.set(ip, entry);
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of codeAttempts) {
    if (now - entry.firstAttempt > CODE_RATE_WINDOW) codeAttempts.delete(ip);
  }
}, CODE_RATE_WINDOW);

/**
 * Resolve the gym for a kiosk request via :gym_slug + hardware_token,
 * OR via authenticated staff JWT (req.gymId set by authenticate middleware).
 *
 * On success, sets:
 *   req.gymId       — numeric gym id
 *   req.gymSecrets  — { qr_hmac_secret, hardware_secret } (only when needed)
 */
async function resolveGymForKiosk(req, res, next) {
  // Path 1: staff JWT already set req.gymId via authenticate
  if (req.gymId) {
    const r = await query(
      'SELECT id, qr_hmac_secret, hardware_secret FROM gyms WHERE id = $1 AND is_active = true',
      [req.gymId]
    );
    if (r.rows.length === 0) {
      return res.status(403).json({ success: false, message: 'Gym not found or inactive.' });
    }
    req.gymSecrets = r.rows[0];
    return next();
  }
  // Path 2: kiosk slug + hardware_token
  const slug = req.params.gym_slug;
  const hardwareToken = req.body?.hardware_token || req.headers['x-hardware-token'];
  if (!slug || !hardwareToken) {
    return res.status(401).json({ success: false, message: 'Authentication required (gym_slug + hardware_token, or staff JWT).' });
  }
  const r = await query(
    'SELECT id, qr_hmac_secret, hardware_secret FROM gyms WHERE slug = $1 AND is_active = true',
    [slug]
  );
  if (r.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Gym not found.' });
  }
  const gym = r.rows[0];
  if (!safeCompare(hardwareToken, gym.hardware_secret)) {
    return res.status(403).json({ success: false, message: 'Invalid hardware token.' });
  }
  req.gymId = gym.id;
  req.gymSecrets = gym;
  next();
}

/**
 * POST /api/kiosk/:gym_slug/verify-code
 * Body: { code, hardware_token } OR (with staff JWT) { code }
 */
router.post('/:gym_slug/verify-code', codeRateLimit, optionalAuth, resolveGymForKiosk, async (req, res) => {
  const { code } = req.body;
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: '6 raqamli kod kiriting' });
  }

  try {
    const result = await withGym(req.gymId, async (db) => {
      const codeResult = await db.query(
        `SELECT id, member_id, used FROM entry_codes
         WHERE code = $1 AND valid_date = CURRENT_DATE`,
        [code]
      );
      if (codeResult.rows.length === 0) {
        return { success: true, granted: false, name: "Noma'lum", plan: '', days_left: 0, message: "Kod topilmadi yoki muddati o'tgan" };
      }
      const entry = codeResult.rows[0];
      if (entry.used) {
        return { success: true, granted: false, name: '', plan: '', days_left: 0, message: 'Bu kod allaqachon ishlatilgan' };
      }

      const member = await db.query(
        `SELECT m.id, m.first_name, COALESCE(p.name, 'none') AS plan
         FROM members m LEFT JOIN plans p ON p.id = m.plan_id
         WHERE m.id = $1 AND m.is_active = true`,
        [entry.member_id]
      );
      if (member.rows.length === 0) {
        return { success: true, granted: false, name: "Noma'lum", plan: '', days_left: 0, message: "A'zo topilmadi" };
      }
      const m = member.rows[0];

      const sub = await db.query(
        `SELECT id, total_days, days_used FROM subscriptions
         WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
         ORDER BY created_at DESC LIMIT 1`,
        [m.id]
      );
      if (sub.rows.length === 0) {
        const frozen = await db.query(
          `SELECT id FROM subscriptions WHERE member_id = $1 AND status = 'frozen'`,
          [m.id]
        );
        const msg = frozen.rows.length > 0 ? 'Abonement muzlatilgan (frozen)' : 'Abonement tugagan';
        return { success: true, granted: false, name: m.first_name, plan: m.plan, days_left: 0, message: msg };
      }
      const daysLeft = sub.rows[0].total_days - sub.rows[0].days_used;
      return {
        success: true, pending: true,
        memberId: m.id,
        subscriptionId: sub.rows[0].id,
        codeId: entry.id,
        name: m.first_name, plan: m.plan, days_left: daysLeft,
      };
    });
    res.json(result);
  } catch (err) {
    console.error('[Kiosk verify-code] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server xatolik.' });
  }
});

/**
 * POST /api/kiosk/:gym_slug/scan
 * Body: { token: <qrToken>, hardware_token } OR (with JWT) { token }
 */
router.post('/:gym_slug/scan', codeRateLimit, optionalAuth, resolveGymForKiosk, async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "QR token yo'q" });

  const verified = verifyQrToken(token, req.gymSecrets.qr_hmac_secret);
  if (!verified || verified.gymId !== req.gymId) {
    return res.json({ success: true, granted: false, name: "Noma'lum", plan: '', days_left: 0, message: "QR kod yaroqsiz yoki muddati o'tgan" });
  }

  try {
    const result = await withGym(req.gymId, async (db) => {
      const member = await db.query(
        `SELECT m.id, m.first_name, COALESCE(p.name, 'none') AS plan
         FROM members m LEFT JOIN plans p ON p.id = m.plan_id
         WHERE m.telegram_id = $1 AND m.is_active = true`,
        [verified.telegramId]
      );
      if (member.rows.length === 0) {
        return { success: true, granted: false, name: "Noma'lum", plan: '', days_left: 0, message: "A'zo topilmadi." };
      }
      const m = member.rows[0];
      const sub = await db.query(
        `SELECT id, total_days, days_used FROM subscriptions
         WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
         ORDER BY created_at DESC LIMIT 1`,
        [m.id]
      );
      if (sub.rows.length === 0) {
        const frozen = await db.query(
          `SELECT id FROM subscriptions WHERE member_id = $1 AND status = 'frozen'`,
          [m.id]
        );
        const msg = frozen.rows.length > 0 ? 'Abonement muzlatilgan (frozen)' : 'Abonement tugagan';
        return { success: true, granted: false, name: m.first_name, plan: m.plan, days_left: 0, message: msg };
      }
      const daysLeft = sub.rows[0].total_days - sub.rows[0].days_used;
      return {
        success: true, pending: true,
        memberId: m.id,
        subscriptionId: sub.rows[0].id,
        telegramId: verified.telegramId,
        name: m.first_name, plan: m.plan, days_left: daysLeft,
      };
    });
    res.json(result);
  } catch (err) {
    console.error('[Kiosk scan] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server xatolik.' });
  }
});

/**
 * POST /api/kiosk/:gym_slug/approve-checkin
 * Body: { memberId, subscriptionId, hardware_token } OR with staff JWT.
 * Atomically: locks subscription row, deducts a session if applicable,
 * inserts checkin, marks today's entry code as used.
 */
router.post('/:gym_slug/approve-checkin', codeRateLimit, optionalAuth, resolveGymForKiosk, async (req, res) => {
  const { memberId, subscriptionId } = req.body;
  if (!memberId || !subscriptionId) {
    return res.status(400).json({ success: false, message: 'memberId va subscriptionId kerak.' });
  }
  if (req.user && !['admin', 'receptionist', 'super_admin'].includes(req.user.role)) {
    return res.status(403).json({ success: false, message: 'Not authorized.' });
  }

  try {
    const result = await withGym(req.gymId, async (db) => {
      const memberCheck = await db.query('SELECT is_active FROM members WHERE id = $1', [memberId]);
      if (memberCheck.rows.length === 0 || memberCheck.rows[0].is_active === false) {
        return { success: true, granted: false, message: "A'zo bloklangan." };
      }

      const subCheck = await db.query(
        `SELECT total_days, days_used, visit_quota, allow_multi_entry_per_day, status, expires_at
         FROM subscriptions WHERE id = $1 AND member_id = $2 FOR UPDATE`,
        [subscriptionId, memberId]
      );
      if (subCheck.rows.length === 0) {
        return { success: false, status: 404, message: 'Subscription not found.' };
      }
      const subRow = subCheck.rows[0];

      if (subRow.total_days - subRow.days_used <= 0) {
        return { success: true, granted: false, message: 'Abonement tugagan (kunlar qolmagan).' };
      }
      if (subRow.status === 'frozen') {
        return { success: true, granted: false, message: 'Abonement muzlatilgan.' };
      }
      if (subRow.expires_at && new Date(subRow.expires_at) < new Date()) {
        return { success: true, granted: false, message: 'Abonement muddati tugagan.' };
      }

      let shouldDeduct = subRow.visit_quota !== null;
      if (shouldDeduct && subRow.allow_multi_entry_per_day) {
        const todayCheck = await db.query(
          `SELECT id FROM checkins WHERE member_id = $1 AND checked_in_at::date = CURRENT_DATE`,
          [memberId]
        );
        if (todayCheck.rows.length > 0) shouldDeduct = false;
      }

      if (shouldDeduct) {
        await db.query('UPDATE subscriptions SET days_used = days_used + 1 WHERE id = $1', [subscriptionId]);
      }
      await db.query(
        `INSERT INTO checkins (gym_id, member_id, subscription_id, approved_by_staff)
         VALUES (current_gym_id(), $1, $2, true)`,
        [memberId, subscriptionId]
      );
      await db.query(
        `UPDATE entry_codes SET used = true
         WHERE member_id = $1 AND valid_date = CURRENT_DATE AND used = false`,
        [memberId]
      );

      const sub = await db.query('SELECT total_days, days_used, visit_quota FROM subscriptions WHERE id = $1', [subscriptionId]);
      const member = await db.query(
        `SELECT m.first_name, COALESCE(p.name, 'none') AS plan
         FROM members m LEFT JOIN plans p ON p.id = m.plan_id WHERE m.id = $1`,
        [memberId]
      );
      const isUnlimited = sub.rows[0].visit_quota === null;
      const daysLeft = isUnlimited ? 'Unlimited' : (sub.rows[0].total_days - sub.rows[0].days_used);

      return {
        success: true, granted: true,
        name: member.rows[0].first_name,
        plan: member.rows[0].plan,
        days_left: daysLeft,
        message: isUnlimited ? 'Kirish ruxsat etildi. Cheksiz abonement.' : `Kirish ruxsat etildi. ${daysLeft} kun qoldi.`,
      };
    });

    if (result.status) {
      const status = result.status;
      delete result.status;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    console.error('[Kiosk approve] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server xatolik.' });
  }
});

/**
 * Optional JWT auth — sets req.user / req.gymId if a valid token is present,
 * otherwise falls through (the kiosk hardware_token path handles it).
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.token;
  if (!token) return next();
  return authenticate(req, res, (err) => {
    // Even if JWT validation fails, fall through — hardware_token may still work.
    if (err) { req.user = null; req.gymId = null; }
    next();
  });
}

module.exports = router;
