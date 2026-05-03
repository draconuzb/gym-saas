const express = require('express');
const router = express.Router();
const { withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

// All routes require an authenticated tenant context
router.use(authenticate, requireGym);

// GET all settings (admin only) — returns key-value map
router.get('/', authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const settings = await withGym(req.gymId, async (db) => {
      const result = await db.query("SELECT key, value FROM settings WHERE key NOT LIKE 'lang_%'");
      const out = {};
      result.rows.forEach(r => { out[r.key] = r.value; });
      return out;
    });
    res.json({ success: true, data: settings });
  } catch (err) {
    console.error('[Settings] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT update settings (batch) — admin only
router.put('/', authorize('admin', 'super_admin'), async (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ success: false, message: 'Request body must be an object of key-value pairs.' });
  }

  const allowedKeys = ['gym_name', 'support_phone', 'support_username',
                       'notify_expiry', 'notify_receipts', 'notify_daily_summary'];
  const filtered = {};
  for (const [key, value] of Object.entries(updates)) {
    if (allowedKeys.includes(key)) filtered[key] = value;
  }

  try {
    await withGym(req.gymId, async (db) => {
      for (const [key, value] of Object.entries(filtered)) {
        await db.query(
          `INSERT INTO settings (gym_id, key, value)
           VALUES (current_gym_id(), $1, $2)
           ON CONFLICT (gym_id, key) DO UPDATE SET value = EXCLUDED.value`,
          [key, String(value)]
        );
      }
    });
    res.json({ success: true, message: 'Settings updated.' });
  } catch (err) {
    console.error('[Settings] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
