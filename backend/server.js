const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { testConnection, withGym } = require('./db/db');
const { authenticate, requireGym } = require('./middleware/auth');

const app = express();
// Cloudflare puts the real client in CF-Connecting-IP and also adds
// X-Forwarded-For. Trust the immediate hop (CF) so req.ip resolves to
// the leftmost X-Forwarded-For; security helpers prefer CF-Connecting-IP.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 5000;

app.use(cookieParser());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

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

app.use('/kiosk.html', express.static(path.join(__dirname, '..', 'kiosk.html')));
app.use('/telegram-webapp.html', express.static(path.join(__dirname, '..', 'telegram-webapp.html')));

// ─── Health (no auth) ─────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  const dbOk = await testConnection().catch(() => false);
  res.json({
    status: dbOk ? 'ok' : 'degraded',
    database: dbOk ? 'connected' : 'disconnected',
    uptime: process.uptime(),
    timestamp: new Date(),
  });
});

// ─── Dashboard stats — tenant-scoped ──────────────────────────
app.get('/api/stats', authenticate, requireGym, async (req, res) => {
  try {
    const stats = await withGym(req.gymId, async (db) => {
      const [active, checkins, revenue, expiring, newMembers, dailyVisitors, dailyRevenue] =
        await Promise.all([
          db.query(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active' AND (total_days - days_used) > 0`),
          db.query(`SELECT COUNT(*) AS n FROM checkins WHERE checked_in_at::date = CURRENT_DATE`),
          db.query(`SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'completed' AND created_at >= date_trunc('month', CURRENT_DATE)`),
          db.query(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'active' AND (total_days - days_used) BETWEEN 1 AND 3`),
          db.query(`SELECT COUNT(*) AS n FROM members WHERE created_at >= date_trunc('month', CURRENT_DATE)`),
          db.query(`SELECT COUNT(*) AS n FROM daily_visits WHERE visited_at::date = CURRENT_DATE`),
          db.query(`SELECT COALESCE(SUM(amount), 0) AS n FROM daily_visits WHERE visited_at >= date_trunc('month', CURRENT_DATE)`),
        ]);
      return {
        activeMembers: parseInt(active.rows[0].n),
        dailyCheckins: parseInt(checkins.rows[0].n),
        dailyVisitors: parseInt(dailyVisitors.rows[0].n),
        monthlyRevenue: parseInt(revenue.rows[0].n) + parseInt(dailyRevenue.rows[0].n),
        expiringSoon: parseInt(expiring.rows[0].n),
        newMembersThisMonth: parseInt(newMembers.rows[0].n),
      };
    });
    res.json(stats);
  } catch (err) {
    console.error('[Stats] Error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// ─── Route Modules ────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/super',    require('./routes/gyms'));   // super-admin gym CRUD
app.use('/api/kiosk',    require('./routes/kiosk'));  // per-gym kiosk endpoints
app.use('/api/members',  require('./routes/members'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/hardware', require('./routes/hardware'));
app.use('/api/trainers', require('./routes/trainers'));
app.use('/api/classes',  require('./routes/classes'));
app.use('/api/reports',  require('./routes/reports'));
app.use('/api/plans',    require('./routes/plans'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/database', require('./routes/database'));
app.use('/api/daily',    require('./routes/daily'));
app.use('/api/attendance', require('./routes/attendance'));

app.use((err, req, res, next) => {
  console.error('[Server] Unhandled error:', err.message);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

async function start() {
  if (process.env.NODE_ENV === 'production') {
    const required = ['JWT_SECRET', 'DB_HOST', 'DB_PASSWORD'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
      console.error('[Server] FATAL: Missing required env vars:', missing.join(', '));
      process.exit(1);
    }
  }

  const dbOk = await testConnection();
  if (!dbOk && process.env.NODE_ENV !== 'production') {
    console.warn('[Server] WARNING: Database not available. Routes will return errors.');
  }

  app.listen(PORT, () => {
    console.log(`\n  GymSystem SaaS API running → http://localhost:${PORT}`);
    console.log(`  Health → http://localhost:${PORT}/api/health\n`);
  });

  // Bot manager — spins up one Telegraf instance per active gym
  if (process.env.ENABLE_BOTS !== 'false') {
    try {
      const { startAllBots } = require('./bot');
      await startAllBots(app);
      console.log('[Server] Bot manager started');
    } catch (err) {
      console.error('[Server] CRITICAL: Bot manager failed to load:', err.message);
      if (process.env.NODE_ENV === 'production') process.exit(1);
    }
  }

  // Cron worker (subscription expiry, birthday reminders, etc.)
  if (process.env.ENABLE_WORKER !== 'false') {
    require('./worker');
  }
}

module.exports = { app };

if (require.main === module) start();
