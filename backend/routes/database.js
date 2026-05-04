const express = require('express');
const router = express.Router();
const { withGym, testConnection } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

// Tables that have a gym_id column (i.e. tenant-scoped, RLS-protected)
const TENANT_TABLES = [
  'members', 'subscriptions', 'checkins', 'payments', 'plans',
  'trainers', 'classes', 'class_enrollments', 'bot_admins',
  'settings', 'daily_visits', 'entry_codes',
];
// users has nullable gym_id; we still scope to gym for status counts
const ALL_TABLES = [...TENANT_TABLES, 'users'];

function safeTableName(name) {
  if (!ALL_TABLES.includes(name)) throw new Error(`Invalid table name: ${name}`);
  return name;
}

router.use(authenticate, requireGym, authorize('admin', 'super_admin'));

// GET /api/database/status — row counts for the current gym only
router.get('/status', async (req, res) => {
  try {
    const dbOk = await testConnection();
    const stats = await withGym(req.gymId, async (db) => {
      const out = {};
      for (const table of ALL_TABLES) {
        try {
          safeTableName(table);
          // users for the current gym only (gym_id matches; super_admins not counted)
          const sql = table === 'users'
            ? `SELECT COUNT(*) AS count FROM users WHERE gym_id = current_gym_id()`
            : `SELECT COUNT(*) AS count FROM ${table}`;
          const r = await db.query(sql);
          out[table] = parseInt(r.rows[0]?.count || '0');
        } catch {
          out[table] = 0;
        }
      }
      return out;
    });
    const totalRows = Object.values(stats).reduce((a, b) => a + b, 0);
    res.json({
      success: true,
      data: {
        connected: dbOk,
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME || 'gym_system',
        user: process.env.DB_USER || 'gym_admin',
        tables: stats,
        totalRows,
      },
    });
  } catch (err) {
    console.error('[Database] Status error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST /api/database/export — current gym's data only
router.post('/export', async (req, res) => {
  console.log(`[Database] AUDIT: Export by user_id=${req.user?.id} gym_id=${req.gymId} at ${new Date().toISOString()}`);
  try {
    const backup = await withGym(req.gymId, async (db) => {
      const dump = { exportedAt: new Date().toISOString(), exportedBy: req.user?.id, gymId: req.gymId, tables: {} };
      for (const table of TENANT_TABLES) {
        try {
          safeTableName(table);
          const r = await db.query(`SELECT * FROM ${table}`);
          if (table === 'settings') {
            dump.tables[table] = r.rows.filter(row => !row.key.startsWith('lang_'));
          } else {
            dump.tables[table] = r.rows;
          }
        } catch {
          dump.tables[table] = [];
        }
      }
      // users: only this gym's staff, password_hash stripped
      const usersRes = await db.query(`SELECT * FROM users WHERE gym_id = current_gym_id()`);
      dump.tables.users = usersRes.rows.map(({ password_hash, ...rest }) => rest);
      return dump;
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=gym${req.gymId}-backup-${new Date().toISOString().split('T')[0]}.json`
    );
    res.json(backup);
  } catch (err) {
    console.error('[Database] Export error:', err.message);
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

// POST /api/database/import — atomic import into the current gym
router.post('/import', async (req, res) => {
  console.log(`[Database] AUDIT: Import by user_id=${req.user?.id} gym_id=${req.gymId} at ${new Date().toISOString()}`);
  try {
    const { tables } = req.body;
    if (!tables || typeof tables !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid backup format.' });
    }
    const imported = await withGym(req.gymId, async (db) => {
      const out = {};

      if (Array.isArray(tables.settings)) {
        for (const row of tables.settings) {
          await db.query(
            `INSERT INTO settings (gym_id, key, value)
             VALUES (current_gym_id(), $1, $2)
             ON CONFLICT (gym_id, key) DO UPDATE SET value = EXCLUDED.value`,
            [row.key, row.value]
          );
        }
        out.settings = tables.settings.length;
      }
      if (Array.isArray(tables.plans)) {
        for (const p of tables.plans) {
          await db.query(
            `INSERT INTO plans (gym_id, name, emoji, price, days, description, is_active, sort_order,
                visit_quota, calendar_duration_months, allow_multi_entry_per_day)
             VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [p.name, p.emoji || '📦', p.price || 0, p.days || 12, p.description || '',
             p.is_active !== false, p.sort_order || 0,
             p.visit_quota !== undefined ? p.visit_quota : (p.days || 12),
             p.calendar_duration_months || 1, p.allow_multi_entry_per_day === true]
          );
        }
        out.plans = tables.plans.length;
      }
      if (Array.isArray(tables.trainers)) {
        for (const t of tables.trainers) {
          await db.query(
            `INSERT INTO trainers (gym_id, first_name, last_name, specialty, phone, is_active)
             VALUES (current_gym_id(), $1, $2, $3, $4, $5)`,
            [t.first_name, t.last_name || null, t.specialty || null, t.phone || null, t.is_active !== false]
          );
        }
        out.trainers = tables.trainers.length;
      }
      return out;
    });
    res.json({ success: true, message: 'Import completed.', imported });
  } catch (err) {
    console.error('[Database] Import error:', err.message);
    res.status(500).json({ success: false, message: 'Import failed: ' + err.message });
  }
});

// POST /api/database/reset/:table — clear a specific table FOR THIS GYM only
router.post('/reset/:table', async (req, res) => {
  const { table } = req.params;
  const { confirm } = req.body;
  const allowed = ['checkins', 'payments', 'class_enrollments'];
  if (!allowed.includes(table)) {
    return res.status(400).json({ success: false, message: `Table '${table}' cannot be reset. Allowed: ${allowed.join(', ')}` });
  }
  if (confirm !== `DELETE_ALL_${table.toUpperCase()}`) {
    return res.status(400).json({ success: false, message: `Send { confirm: "DELETE_ALL_${table.toUpperCase()}" } to confirm.` });
  }
  console.log(`[Database] AUDIT: Reset "${table}" by user_id=${req.user?.id} gym_id=${req.gymId} at ${new Date().toISOString()}`);

  try {
    safeTableName(table);
    const count = await withGym(req.gymId, async (db) => {
      // RLS auto-scopes the DELETE to this gym only
      const r = await db.query(`DELETE FROM ${table}`);
      return r.rowCount;
    });
    res.json({ success: true, message: `Table '${table}' cleared for this gym. ${count} rows deleted.` });
  } catch (err) {
    console.error('[Database] Reset error:', err.message);
    res.status(500).json({ success: false, message: 'Reset failed.' });
  }
});

module.exports = router;
