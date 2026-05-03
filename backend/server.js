const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
// Load .env from backend/ dir first, fallback to project root
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { testConnection, query, getClient } = require('./db/db');
const { authenticate, verifyToken } = require('./middleware/auth');
const { makeQrToken, verifyQrToken } = require('./lib/qr');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return require('crypto').timingSafeEqual(bufA, bufB);
}

// ─── Middleware ───────────────────────────────────────────────
app.use(cookieParser());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'], credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Disable caching for all API responses
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path.startsWith('/api/')) {
      console.log(`[${req.method}] ${req.path} ${res.statusCode} ${ms}ms`);
    }
  });
  next();
});

// Serve kiosk and telegram-webapp static files
app.use('/kiosk.html', express.static(path.join(__dirname, '..', 'kiosk.html')));
app.use('/telegram-webapp.html', express.static(path.join(__dirname, '..', 'telegram-webapp.html')));

// ─── Health Check ─────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const dbOk = await testConnection().catch(() => false);
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date(),
  });
});

// ─── Dashboard Stats (real data) ─────────────────────────────
app.get('/api/stats', authenticate, async (req, res) => {
  try {
    const [active, checkins, revenue, expiring, newMembers] = await Promise.all([
      query(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active' AND (total_days - days_used) > 0`),
      query(`SELECT COUNT(*) AS n FROM checkins WHERE checked_in_at::date = CURRENT_DATE`),
      query(`SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'completed' AND created_at >= date_trunc('month', CURRENT_DATE)`),
      query(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active' AND (total_days - days_used) BETWEEN 1 AND 3`),
      query(`SELECT COUNT(*) AS n FROM members WHERE created_at >= date_trunc('month', CURRENT_DATE)`),
    ]);

    // Daily walk-in visitors
    const [dailyVisitors, dailyRevenue] = await Promise.all([
      query(`SELECT COUNT(*) AS n FROM daily_visits WHERE visited_at::date = CURRENT_DATE`),
      query(`SELECT COALESCE(SUM(amount), 0) AS n FROM daily_visits WHERE visited_at >= date_trunc('month', CURRENT_DATE)`),
    ]);

    res.json({
      activeMembers: parseInt(active.rows[0].n),
      dailyCheckins: parseInt(checkins.rows[0].n),
      dailyVisitors: parseInt(dailyVisitors.rows[0].n),
      monthlyRevenue: parseInt(revenue.rows[0].n) + parseInt(dailyRevenue.rows[0].n),
      expiringSoon: parseInt(expiring.rows[0].n),
      newMembersThisMonth: parseInt(newMembers.rows[0].n),
    });
  } catch (err) {
    console.error('[Stats] Error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// ─── Rate limiter for code verification endpoints ─────────────
const codeAttempts = new Map();
const CODE_RATE_WINDOW = 5 * 60 * 1000; // 5 minutes
const CODE_MAX_ATTEMPTS = 10;

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

// ─── Kiosk Code Verification Endpoint ─────────────────────────
app.post('/api/verify-code', codeRateLimit, async (req, res) => {
  // Require JWT or kiosk hardware token
  const authHeader = req.headers['authorization'];
  const jwtToken = authHeader && authHeader.split(' ')[1];
  const { kioskToken } = req.body;
  const isKiosk = safeCompare(kioskToken, process.env.HARDWARE_AUTH_SECRET);
  if (!jwtToken && !isKiosk) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  if (jwtToken) {
    try { verifyToken(jwtToken); } catch(e) {
      if (!isKiosk) return res.status(403).json({ success: false, message: 'Invalid token.' });
    }
  }

  const { code } = req.body;
  if (!code || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ success: false, message: "6 raqamli kod kiriting" });
  }

  try {
    // Find the code for today
    const codeResult = await query(
      `SELECT ec.id, ec.member_id, ec.used FROM entry_codes ec
       WHERE ec.code = $1 AND ec.valid_date = CURRENT_DATE`,
      [code]
    );

    if (codeResult.rows.length === 0) {
      return res.json({ success: true, granted: false, name: "Noma'lum", plan: '', days_left: 0, message: "Kod topilmadi yoki muddati o'tgan" });
    }

    const entry = codeResult.rows[0];

    if (entry.used) {
      return res.json({ success: true, granted: false, name: "", plan: '', days_left: 0, message: "Bu kod allaqachon ishlatilgan" });
    }

    // Get member info
    const member = await query(
      `SELECT m.id, m.first_name, COALESCE(p.name, 'none') AS plan FROM members m LEFT JOIN plans p ON p.id = m.plan_id WHERE m.id = $1 AND m.is_active = true`,
      [entry.member_id]
    );

    if (member.rows.length === 0) {
      return res.json({ success: true, granted: false, name: "Noma'lum", plan: '', days_left: 0, message: "A'zo topilmadi" });
    }

    const m = member.rows[0];

    // Get active subscription
    const sub = await query(
      `SELECT id, total_days, days_used FROM subscriptions
       WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
       ORDER BY created_at DESC LIMIT 1`,
      [m.id]
    );

    if (sub.rows.length === 0) {
      const frozen = await query('SELECT id FROM subscriptions WHERE member_id = $1 AND status = $2', [m.id, 'frozen']);
      const msg = frozen.rows.length > 0 ? 'Abonement muzlatilgan (frozen)' : 'Abonement tugagan';
      return res.json({ success: true, granted: false, name: m.first_name, plan: m.plan, days_left: 0, message: msg });
    }

    const daysLeft = sub.rows[0].total_days - sub.rows[0].days_used;

    // Each scan is a separate entry — member can come multiple times a day, burning one session each.
    return res.json({
      success: true, pending: true,
      memberId: m.id,
      subscriptionId: sub.rows[0].id,
      codeId: entry.id,
      name: m.first_name, plan: m.plan, days_left: daysLeft,
    });
  } catch (err) {
    console.error('[VerifyCode] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server xatolik.' });
  }
});

// ─── Kiosk QR Scan Endpoint ──────────────────────────────────
app.post('/api/scan', codeRateLimit, async (req, res) => {
  // Require JWT or kiosk hardware token
  const authHeader = req.headers['authorization'];
  const jwtScanToken = authHeader && authHeader.split(' ')[1];
  const { kioskToken: scanKioskToken } = req.body;
  const isScanKiosk = safeCompare(scanKioskToken, process.env.HARDWARE_AUTH_SECRET);
  if (!jwtScanToken && !isScanKiosk) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }
  if (jwtScanToken) {
    try { verifyToken(jwtScanToken); } catch(e) {
      if (!isScanKiosk) return res.status(403).json({ success: false, message: 'Invalid token.' });
    }
  }

  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: "Token yo'q" });

  const verified = verifyQrToken(token);
  if (!verified) {
    return res.json({ success: true, granted: false, name: "Noma'lum", plan: '', days_left: 0, message: "QR kod yaroqsiz yoki muddati o'tgan" });
  }

  try {
    const member = await query(
      `SELECT m.id, m.first_name, COALESCE(p.name, 'none') AS plan FROM members m LEFT JOIN plans p ON p.id = m.plan_id WHERE m.telegram_id = $1 AND m.is_active = true`,
      [verified.telegramId]
    );

    if (member.rows.length === 0) {
      return res.json({ success: true, granted: false, name: "Noma'lum", plan: '', days_left: 0, message: "A'zo topilmadi." });
    }

    const m = member.rows[0];
    const sub = await query(
      `SELECT id, total_days, days_used FROM subscriptions
       WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
       ORDER BY created_at DESC LIMIT 1`,
      [m.id]
    );

    if (sub.rows.length === 0) {
      const frozen = await query('SELECT id FROM subscriptions WHERE member_id = $1 AND status = $2', [m.id, 'frozen']);
      const msg = frozen.rows.length > 0 ? 'Abonement muzlatilgan (frozen)' : 'Abonement tugagan';
      return res.json({ success: true, granted: false, name: m.first_name, plan: m.plan, days_left: 0, message: msg });
    }

    const daysLeft = sub.rows[0].total_days - sub.rows[0].days_used;

    // Each scan is a separate entry — member can come multiple times/day (each burns a session).
    return res.json({
      success: true, pending: true,
      memberId: m.id,
      subscriptionId: sub.rows[0].id,
      telegramId: verified.telegramId,
      name: m.first_name, plan: m.plan, days_left: daysLeft,
    });
  } catch (err) {
    console.error('[Scan] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server xatolik.' });
  }
});

// ─── Kiosk Approve Check-in ──────────────────────────────────
app.post('/api/approve-checkin', codeRateLimit, async (req, res) => {
  const { memberId, subscriptionId, kioskToken } = req.body;

  // Allow if valid JWT or kiosk hardware token
  const authHeader = req.headers['authorization'];
  const jwtToken = authHeader && authHeader.split(' ')[1];
  const isKiosk = safeCompare(kioskToken, process.env.HARDWARE_AUTH_SECRET);

  if (!jwtToken && !isKiosk) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  if (jwtToken) {
    try {
      const decoded = verifyToken(jwtToken);
      if (!['admin', 'receptionist'].includes(decoded.role)) {
        return res.status(403).json({ success: false, message: 'Not authorized.' });
      }
    } catch {
      return res.status(403).json({ success: false, message: 'Invalid token.' });
    }
  }

  if (!memberId || !subscriptionId) {
    return res.status(400).json({ success: false, message: "memberId va subscriptionId kerak." });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Check if member is active (not blocked)
    const memberCheck = await client.query('SELECT is_active FROM members WHERE id = $1', [memberId]);
    if (memberCheck.rows.length === 0 || memberCheck.rows[0].is_active === false) {
      await client.query('ROLLBACK');
      return res.json({ success: true, granted: false, message: "A'zo bloklangan." });
    }

    // Lock the subscription row (including dynamic tariff fields)
    const subCheck = await client.query(
      `SELECT total_days, days_used, visit_quota, allow_multi_entry_per_day, status, expires_at
       FROM subscriptions WHERE id = $1 AND member_id = $2 FOR UPDATE`,
      [subscriptionId, memberId]
    );

    if (subCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Subscription not found.' });
    }
    const subRow = subCheck.rows[0];

    // Re-check remaining days after acquiring lock (prevent race condition)
    if (subRow.total_days - subRow.days_used <= 0) {
      await client.query('ROLLBACK');
      return res.json({ success: true, granted: false, message: 'Abonement tugagan (kunlar qolmagan).' });
    }

    // Reject frozen subscriptions
    if (subRow.status === 'frozen') {
      await client.query('ROLLBACK');
      return res.json({ success: true, granted: false, message: 'Abonement muzlatilgan.' });
    }

    // Calendar hard expiry check
    if (subRow.expires_at && new Date(subRow.expires_at) < new Date()) {
      await client.query('ROLLBACK');
      return res.json({ success: true, granted: false, message: 'Abonement muddati tugagan.' });
    }

    // Each scan = one entry. Deduction rule:
    //   - visit_quota NULL (unlimited VIP): never deduct
    //   - allow_multi_entry_per_day: if already checked in today, don't deduct again (day-pass model)
    //   - otherwise: every scan burns one session (member can come multiple times/day, each burns one)
    let shouldDeduct = subRow.visit_quota !== null;

    if (shouldDeduct && subRow.allow_multi_entry_per_day) {
      const todayCheck = await client.query(
        `SELECT id FROM checkins WHERE member_id = $1 AND checked_in_at::date = CURRENT_DATE`,
        [memberId]
      );
      if (todayCheck.rows.length > 0) shouldDeduct = false;
    }

    if (shouldDeduct) {
      await client.query('UPDATE subscriptions SET days_used = days_used + 1 WHERE id = $1', [subscriptionId]);
    }
    await client.query('INSERT INTO checkins (member_id, subscription_id, approved_by_staff) VALUES ($1, $2, true)', [memberId, subscriptionId]);

    // Mark any entry code as used for today
    await client.query('UPDATE entry_codes SET used = true WHERE member_id = $1 AND valid_date = CURRENT_DATE AND used = false', [memberId]);

    await client.query('COMMIT');

    const sub = await query('SELECT total_days, days_used, visit_quota FROM subscriptions WHERE id = $1', [subscriptionId]);
    const member = await query(`SELECT m.first_name, COALESCE(p.name, 'none') AS plan FROM members m LEFT JOIN plans p ON p.id = m.plan_id WHERE m.id = $1`, [memberId]);
    const isUnlimited = sub.rows[0].visit_quota === null;
    const daysLeft = isUnlimited ? 'Unlimited' : (sub.rows[0].total_days - sub.rows[0].days_used);

    return res.json({
      success: true, granted: true,
      name: member.rows[0].first_name,
      plan: member.rows[0].plan,
      days_left: daysLeft,
      message: isUnlimited ? 'Kirish ruxsat etildi. Cheksiz abonement.' : `Kirish ruxsat etildi. ${daysLeft} kun qoldi.`,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Approve] Error:', err.message);
    res.status(500).json({ success: false, message: 'Server xatolik.' });
  } finally {
    client.release();
  }
});

// ─── Route Modules ────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/members', require('./routes/members'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/hardware', require('./routes/hardware'));
app.use('/api/trainers', require('./routes/trainers'));
app.use('/api/classes', require('./routes/classes'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/plans', require('./routes/plans'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/database', require('./routes/database'));
app.use('/api/daily', require('./routes/daily'));
app.use('/api/attendance', require('./routes/attendance'));

// ─── Global Error Handler ─────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ─── Boot ─────────────────────────────────────────────────────
async function start() {
  // Validate required environment variables
  if (process.env.NODE_ENV === 'production') {
    const required = ['JWT_SECRET', 'QR_HMAC_SECRET', 'HARDWARE_AUTH_SECRET', 'DB_HOST', 'DB_PASSWORD'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      console.error('[Server] FATAL: Missing required env vars:', missing.join(', '));
      process.exit(1);
    }
  }

  const dbOk = await testConnection();
  if (!dbOk) {
    console.warn('[Server] WARNING: Database not available. API will start but DB queries will fail.');
  }

  app.listen(PORT, () => {
    console.log(`\n  GymSystem API running → http://localhost:${PORT}`);
    console.log(`  Kiosk → http://localhost:${PORT}/kiosk.html`);
  });

  // HTTPS for camera access (kiosk QR scanner needs HTTPS)
  try {
    const https = require('https');
    const fs = require('fs');
    const HTTPS_PORT = parseInt(PORT) + 1;
    const sslOpts = {
      key: fs.readFileSync('/tmp/gym-key.pem'),
      cert: fs.readFileSync('/tmp/gym-cert.pem'),
    };
    https.createServer(sslOpts, app).listen(HTTPS_PORT, () => {
      console.log(`  Kiosk (HTTPS) → https://localhost:${HTTPS_PORT}/kiosk.html\n`);
    });
  } catch (err) {
    console.log(`  (HTTPS not available: ${err.message})\n`);
  }

  // Start bot (if token configured)
  if (process.env.TELEGRAM_BOT_TOKEN) {
    try {
      require('./bot');
      console.log('[Server] Bot module loaded');
    } catch (err) {
      console.error('[Server] CRITICAL: Bot failed to load:', err.message);
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }
  } else {
    console.warn('[Server] WARNING: TELEGRAM_BOT_TOKEN not set — bot disabled');
  }

  // Start cron worker
  require('./worker');
}

module.exports = { app };

start();
