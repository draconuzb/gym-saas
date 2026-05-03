const express = require('express');
const router = express.Router();
const { query, testConnection } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// Whitelist of valid table names (prevents SQL injection)
const VALID_TABLES = ['members', 'subscriptions', 'checkins', 'payments', 'plans', 'trainers', 'classes', 'class_enrollments', 'users', 'bot_admins', 'settings', 'daily_visits', 'entry_codes'];

function safeTableName(name) {
  if (!VALID_TABLES.includes(name)) throw new Error(`Invalid table name: ${name}`);
  return name;
}

// GET database status and table stats
router.get('/status', authenticate, authorize('admin'), async (req, res) => {
  try {
    const dbOk = await testConnection();

    // Get table row counts
    const tables = ['members', 'subscriptions', 'checkins', 'payments', 'plans', 'trainers', 'classes', 'class_enrollments', 'users', 'bot_admins', 'settings'];
    const stats = {};

    for (const table of tables) {
      try {
        safeTableName(table); // validate
        const result = await query(`SELECT COUNT(*) AS count FROM ${table}`);
        stats[table] = parseInt(result.rows[0]?.count || '0');
      } catch {
        stats[table] = 0;
      }
    }

    const totalRows = Object.values(stats).reduce((a, b) => a + b, 0);

    res.json({
      success: true,
      data: {
        connected: dbOk,
        mode: process.env.DB_HOST ? 'postgresql' : 'in-memory',
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

// POST export all data as JSON backup
router.post('/export', authenticate, authorize('admin'), async (req, res) => {
  console.log(`[Database] AUDIT: Data export initiated by user_id=${req.user?.id} role=${req.user?.role} at ${new Date().toISOString()}`);
  try {
    const tables = ['members', 'subscriptions', 'checkins', 'payments', 'plans', 'trainers', 'classes', 'class_enrollments', 'users', 'bot_admins', 'settings'];
    const backup = { exportedAt: new Date().toISOString(), exportedBy: req.user?.id, tables: {} };

    for (const table of tables) {
      try {
        safeTableName(table); // validate
        const result = await query(`SELECT * FROM ${table}`);
        // Strip sensitive fields from export
        if (table === 'users') {
          backup.tables[table] = result.rows.map(({ password_hash, ...rest }) => rest);
        } else if (table === 'settings') {
          // Exclude per-user language prefs (lang_*) to keep export clean
          backup.tables[table] = result.rows.filter(r => !r.key.startsWith('lang_'));
        } else {
          backup.tables[table] = result.rows;
        }
      } catch {
        backup.tables[table] = [];
      }
    }

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=gym-backup-${new Date().toISOString().split('T')[0]}.json`);
    res.json(backup);
  } catch (err) {
    console.error('[Database] Export error:', err.message);
    res.status(500).json({ success: false, message: 'Export failed.' });
  }
});

// POST import data from JSON backup
// M6 fix: wrapped in transaction for atomic import
router.post('/import', authenticate, authorize('admin'), async (req, res) => {
  console.log(`[Database] AUDIT: Data import initiated by user_id=${req.user?.id} role=${req.user?.role} at ${new Date().toISOString()}`);
  try {
    const { tables } = req.body;
    if (!tables || typeof tables !== 'object') {
      return res.status(400).json({ success: false, message: 'Invalid backup format.' });
    }

    const imported = {};

    await query('BEGIN');

    try {
      // Import settings
      if (tables.settings && Array.isArray(tables.settings)) {
        for (const row of tables.settings) {
          await query(
            `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2`,
            [row.key, row.value]
          );
        }
        imported.settings = tables.settings.length;
      }

      // Import plans
      if (tables.plans && Array.isArray(tables.plans)) {
        for (const p of tables.plans) {
          await query(
            `INSERT INTO plans (name, emoji, price, days, description, is_active, sort_order,
               visit_quota, calendar_duration_months, allow_multi_entry_per_day)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [p.name, p.emoji || '📦', p.price || 0, p.days || 12, p.description || '',
             p.is_active !== false, p.sort_order || 0,
             p.visit_quota !== undefined ? p.visit_quota : (p.days || 12),
             p.calendar_duration_months || 1, p.allow_multi_entry_per_day === true]
          );
        }
        imported.plans = tables.plans.length;
      }

      // Import trainers
      if (tables.trainers && Array.isArray(tables.trainers)) {
        for (const t of tables.trainers) {
          await query(
            `INSERT INTO trainers (first_name, last_name, specialty, phone, is_active)
             VALUES ($1, $2, $3, $4, $5)`,
            [t.first_name, t.last_name || null, t.specialty || null, t.phone || null, t.is_active !== false]
          );
        }
        imported.trainers = tables.trainers.length;
      }

      await query('COMMIT');
    } catch (txErr) {
      await query('ROLLBACK');
      throw txErr;
    }

    res.json({ success: true, message: 'Import completed.', imported });
  } catch (err) {
    console.error('[Database] Import error:', err.message);
    res.status(500).json({ success: false, message: 'Import failed: ' + err.message });
  }
});

// POST reset a specific table (dangerous — requires confirmation token)
router.post('/reset/:table', authenticate, authorize('admin'), async (req, res) => {
  const { table } = req.params;
  const { confirm } = req.body;

  const allowed = ['checkins', 'payments', 'class_enrollments'];
  if (!allowed.includes(table)) {
    return res.status(400).json({ success: false, message: `Table '${table}' cannot be reset. Allowed: ${allowed.join(', ')}` });
  }

  if (confirm !== `DELETE_ALL_${table.toUpperCase()}`) {
    return res.status(400).json({ success: false, message: `Send { confirm: "DELETE_ALL_${table.toUpperCase()}" } to confirm.` });
  }

  console.log(`[Database] AUDIT: Table reset "${table}" by user_id=${req.user?.id} role=${req.user?.role} at ${new Date().toISOString()}`);


  try {
    safeTableName(table); // double-validate against whitelist
    const result = await query(`DELETE FROM ${table}`);
    res.json({ success: true, message: `Table '${table}' cleared. ${result.rowCount} rows deleted.` });
  } catch (err) {
    console.error('[Database] Reset error:', err.message);
    res.status(500).json({ success: false, message: 'Reset failed.' });
  }
});

module.exports = router;
