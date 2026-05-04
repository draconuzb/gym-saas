const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query, withGym } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// All endpoints in this file require super_admin
router.use(authenticate, authorize('super_admin'));

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

function genSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * GET /api/super/gyms
 * List all gyms with quick stats.
 */
router.get('/gyms', async (req, res) => {
  try {
    const result = await query(`
      SELECT
        g.id, g.slug, g.name, g.phone, g.is_active, g.plan,
        g.telegram_bot_username, g.created_at,
        (SELECT COUNT(*) FROM members WHERE gym_id = g.id) AS members_count,
        (SELECT COUNT(*) FROM users WHERE gym_id = g.id)   AS staff_count
      FROM gyms g
      ORDER BY g.created_at DESC
    `);
    res.json({ success: true, gyms: result.rows });
  } catch (err) {
    console.error('[Super] List gyms error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/super/gyms
 * Body: { slug, name, phone?, address?, timezone?, plan?,
 *         admin_phone, admin_password, admin_first_name, admin_last_name?,
 *         telegram_bot_token?, telegram_bot_username? }
 * Creates gym + first admin user + default plans atomically.
 */
router.post('/gyms', async (req, res) => {
  const {
    slug, name, phone, address, timezone, plan,
    admin_phone, admin_password, admin_first_name, admin_last_name,
    telegram_bot_token, telegram_bot_username,
  } = req.body;

  if (!slug || !name || !admin_phone || !admin_password || !admin_first_name) {
    return res.status(400).json({
      success: false,
      message: 'slug, name, admin_phone, admin_password, admin_first_name are required.',
    });
  }
  if (!SLUG_RE.test(slug)) {
    return res.status(400).json({
      success: false,
      message: 'slug must be 1-50 lowercase letters/digits/hyphens, not starting/ending with a hyphen.',
    });
  }
  if (admin_password.length < 6) {
    return res.status(400).json({ success: false, message: 'Admin password must be at least 6 characters.' });
  }

  const client = await require('../db/db').getClient();
  try {
    await client.query('BEGIN');

    const gymResult = await client.query(
      `INSERT INTO gyms (
         slug, name, phone, address, timezone, plan,
         telegram_bot_token, telegram_bot_username,
         qr_hmac_secret, hardware_secret
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id, slug, name`,
      [
        slug, name, phone || null, address || null,
        timezone || 'Asia/Tashkent', plan || 'standard',
        telegram_bot_token || null, telegram_bot_username || null,
        genSecret(32), genSecret(32),
      ]
    );
    const gym = gymResult.rows[0];

    // Set tenant context BEFORE inserting RLS-protected rows.
    await client.query('SELECT set_config($1, $2, true)', ['app.current_gym_id', String(gym.id)]);

    const passwordHash = await bcrypt.hash(admin_password, 10);
    await client.query(
      `INSERT INTO users (gym_id, phone, password_hash, role, first_name, last_name)
       VALUES ($1, $2, $3, 'admin', $4, $5)`,
      [gym.id, admin_phone, passwordHash, admin_first_name, admin_last_name || null]
    );
    await client.query(
      `INSERT INTO plans (gym_id, name, emoji, price, days, description, sort_order, visit_quota, calendar_duration_months, allow_multi_entry_per_day)
       VALUES
         ($1, 'Oddiy',   '🥉', 200000, 12, 'Zal kirish',          1, 12, 1, false),
         ($1, 'Premium', '🥈', 350000, 12, 'Zal + trener',        2, 12, 1, false),
         ($1, 'VIP',     '🥇', 550000, 12, 'Zal + trener + jadval', 3, 12, 1, false)`,
      [gym.id]
    );

    await client.query(
      `INSERT INTO settings (gym_id, key, value) VALUES
         ($1, 'gym_name',         $2),
         ($1, 'support_username', '@gym_support_uz'),
         ($1, 'support_phone',    '+998 90 000 00 00')`,
      [gym.id, name]
    );

    await client.query('COMMIT');
    res.status(201).json({ success: true, gym });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Slug or admin phone already exists.' });
    }
    console.error('[Super] Create gym error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/super/gyms/:id
 */
router.get('/gyms/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid gym id.' });
  }
  try {
    const result = await query(
      `SELECT id, slug, name, phone, address, timezone, plan, is_active,
              telegram_bot_username, created_at, updated_at
       FROM gyms WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gym not found.' });
    }
    res.json({ success: true, gym: result.rows[0] });
  } catch (err) {
    console.error('[Super] Get gym error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * PATCH /api/super/gyms/:id
 * Update mutable gym fields (name, phone, address, timezone, plan, is_active,
 * telegram_bot_token, telegram_bot_username). Slug is immutable.
 */
router.patch('/gyms/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid gym id.' });
  }

  const allowed = ['name', 'phone', 'address', 'timezone', 'plan', 'is_active',
                   'telegram_bot_token', 'telegram_bot_username'];
  const fields = [];
  const values = [];
  let i = 1;
  for (const key of allowed) {
    if (key in req.body) {
      fields.push(`${key} = $${i++}`);
      values.push(req.body[key]);
    }
  }
  if (fields.length === 0) {
    return res.status(400).json({ success: false, message: 'No valid fields to update.' });
  }
  fields.push('updated_at = NOW()');
  values.push(id);

  try {
    const result = await query(
      `UPDATE gyms SET ${fields.join(', ')} WHERE id = $${i} RETURNING id, slug, name, is_active`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gym not found.' });
    }
    res.json({ success: true, gym: result.rows[0] });
  } catch (err) {
    console.error('[Super] Update gym error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/super/gyms/:id/rotate-secrets
 * Generate fresh QR + hardware secrets (e.g. if leaked).
 */
router.post('/gyms/:id/rotate-secrets', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid gym id.' });
  }
  try {
    const result = await query(
      `UPDATE gyms SET qr_hmac_secret = $1, hardware_secret = $2, updated_at = NOW()
       WHERE id = $3 RETURNING id, slug`,
      [genSecret(32), genSecret(32), id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Gym not found.' });
    }
    res.json({ success: true, gym: result.rows[0] });
  } catch (err) {
    console.error('[Super] Rotate secrets error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
