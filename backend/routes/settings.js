const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET all settings
router.get('/', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query("SELECT * FROM settings WHERE key NOT LIKE 'lang_%'");
    const settings = {};
    result.rows.forEach(r => { settings[r.key] = r.value; });
    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('[Settings] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT update settings (batch) — admin only
router.put('/', authenticate, authorize('admin'), async (req, res) => {
  const updates = req.body; // { key: value, key2: value2, ... }

  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ success: false, message: 'Request body must be an object of key-value pairs.' });
  }

  const allowedKeys = ['gym_name', 'support_phone', 'support_username', 'notify_expiry', 'notify_receipts', 'notify_daily_summary'];
  const filtered = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedKeys.includes(key)) filtered[key] = value;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(filtered)) {
      await client.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = $2`,
        [key, String(value)]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: 'Settings updated.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Settings] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

module.exports = router;
