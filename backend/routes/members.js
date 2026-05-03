const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const QRCode = require('qrcode');
const { query, getClient } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');
const { makeQrToken } = require('../lib/qr');

// Validate requests to telegram endpoints — require JWT or x-telegram-hash
const validateTelegramRequest = (req, res, next) => {
  // Allow if JWT is present
  const authHeader = req.headers['authorization'];
  if (authHeader) return authenticate(req, res, next);

  // Allow if x-telegram-hash header matches a simple HMAC of the telegram ID
  const tgHash = req.headers['x-telegram-hash'];
  const telegramId = req.params.telegramId;
  if (tgHash) {
    const expected = crypto.createHmac('sha256', process.env.QR_HMAC_SECRET || 'dev').update(String(telegramId)).digest('hex').slice(0, 16);
    if (tgHash === expected) return next();
  }

  return res.status(401).json({ success: false, message: 'Authentication required.' });
};

// GET all members with their active subscription info
router.get('/', authenticate, async (req, res) => {
  try {
    const { search, status } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const fromClause = `
      FROM members m
      LEFT JOIN plans p ON p.id = m.plan_id
      LEFT JOIN LATERAL (
        SELECT total_days, days_used, status, expires_at
        FROM subscriptions
        WHERE member_id = m.id AND status = 'active'
        ORDER BY created_at DESC LIMIT 1
      ) s ON true
    `;
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(m.first_name ILIKE $${params.length} OR m.last_name ILIKE $${params.length} OR m.phone ILIKE $${params.length})`);
    }

    if (status === 'active') {
      conditions.push(`s.status = 'active' AND (s.total_days - s.days_used) > 0`);
    } else if (status === 'expired') {
      conditions.push(`(s.status IS NULL OR s.status != 'active' OR (s.total_days - s.days_used) <= 0)`);
    } else if (status === 'blocked') {
      conditions.push('m.is_active = false');
    }

    const whereClause = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';

    // Count total matching rows
    const countResult = await query(`SELECT COUNT(*) AS count ${fromClause}${whereClause}`, params);
    const total = parseInt(countResult.rows[0].count);

    // Fetch paginated results
    const selectFields = `m.id, m.telegram_id, m.first_name, m.last_name, m.phone, m.plan_id, m.is_active, m.created_at,
        COALESCE(p.name, 'none') AS plan,
        s.total_days, s.days_used, s.status AS sub_status, s.expires_at`;
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const sql = `SELECT ${selectFields} ${fromClause}${whereClause} ORDER BY m.created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const result = await query(sql, [...params, limit, offset]);
    res.json({ success: true, data: result.rows, total, page, limit });
  } catch (err) {
    console.error('[Members] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET member by Telegram ID (secured — used by Telegram mini-app)
router.get('/telegram/:telegramId', validateTelegramRequest, async (req, res) => {
  try {
    const { telegramId } = req.params;

    const memberResult = await query(
      'SELECT * FROM members WHERE telegram_id = $1',
      [telegramId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    const member = memberResult.rows[0];

    // Active subscription
    const subResult = await query(
      `SELECT id, plan_id, plan_name, total_days, days_used, status, created_at, activated_at, expires_at
       FROM subscriptions WHERE member_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [member.id]
    );

    const subscription = subResult.rows[0] || null;
    const daysLeft = subscription ? Math.max(0, subscription.total_days - subscription.days_used) : 0;

    const qrToken = makeQrToken(telegramId);

    res.json({
      success: true,
      data: {
        ...member,
        subscription,
        daysLeft,
        qrToken,
      },
    });
  } catch (err) {
    console.error('[Members] Telegram lookup error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET QR code image for member by Telegram ID (secured)
router.get('/telegram/:telegramId/qr', validateTelegramRequest, async (req, res) => {
  try {
    const { telegramId } = req.params;

    const memberResult = await query(
      'SELECT * FROM members WHERE telegram_id = $1',
      [telegramId]
    );

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    const token = makeQrToken(telegramId);
    const buffer = await QRCode.toBuffer(token, { type: 'png', width: 300, margin: 2 });

    res.set('Content-Type', 'image/png');
    res.send(buffer);
  } catch (err) {
    console.error('[Members] QR generation error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET single member by id with full profile
router.get('/:id', authenticate, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);

    const memberResult = await query(
      `SELECT m.id, m.telegram_id, m.first_name, m.last_name, m.phone, m.plan_id, m.is_active, m.created_at,
        COALESCE(p.name, 'none') AS plan
       FROM members m LEFT JOIN plans p ON p.id = m.plan_id
       WHERE m.id = $1`, [memberId]
    );
    if (memberResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    const member = memberResult.rows[0];

    // Active or frozen subscription
    const subResult = await query(
      `SELECT id, plan_id, plan_name, total_days, days_used, status, created_at, activated_at, expires_at,
         frozen_at, frozen_days_saved, visit_quota, calendar_duration_months, allow_multi_entry_per_day
       FROM subscriptions WHERE member_id = $1 AND status IN ('active', 'frozen')
       ORDER BY created_at DESC LIMIT 1`, [memberId]
    );

    // Recent checkins
    const checkinsResult = await query(
      `SELECT checked_in_at FROM checkins WHERE member_id = $1
       ORDER BY checked_in_at DESC LIMIT 10`, [memberId]
    );

    // Payment history
    const paymentsResult = await query(
      `SELECT id, amount, gateway, status, created_at FROM payments
       WHERE member_id = $1 ORDER BY created_at DESC LIMIT 10`, [memberId]
    );

    // Total visits
    const visitsResult = await query(
      `SELECT COUNT(*) AS total FROM checkins WHERE member_id = $1`, [memberId]
    );

    res.json({
      success: true,
      data: {
        ...member,
        subscription: subResult.rows[0] || null,
        totalVisits: parseInt(visitsResult.rows[0].total),
        recentCheckins: checkinsResult.rows,
        payments: paymentsResult.rows,
      },
    });
  } catch (err) {
    console.error('[Members] Profile error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST register a new member (from dashboard)
// Supports importing existing gym members with remaining subscription days
router.post('/register', authenticate, async (req, res) => {
  const { firstName, lastName, phone, planId, remainingDays } = req.body;
  if (!firstName || !phone) {
    return res.status(400).json({ success: false, message: 'firstName and phone are required.' });
  }

  try {
    const existing = await query('SELECT id FROM members WHERE phone = $1', [phone]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, message: 'Member with this phone already exists.' });
    }

    // Validate plan exists if provided
    let validPlanId = null;
    let planName = 'none';
    let planResult = null;
    if (planId) {
      planResult = await query('SELECT * FROM plans WHERE id = $1', [planId]);
      if (planResult.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Plan not found.' });
      }
      validPlanId = planId;
      planName = planResult.rows[0].name;
    }

    // Wrap member + subscription + payment creation in a transaction
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // Create the member
      const result = await client.query(
        `INSERT INTO members (first_name, last_name, phone, plan_id)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [firstName, lastName || null, phone, validPlanId]
      );
      const member = result.rows[0];

      // If planId and remainingDays provided, create an active subscription (migration)
      if (validPlanId && remainingDays && remainingDays > 0) {

        // Include dynamic tariff snapshot from the plan
        const planData = planResult.rows[0] || {};
        await client.query(
          `INSERT INTO subscriptions (member_id, plan_id, plan_name, total_days, days_used, price, status, activated_at, expires_at,
             visit_quota, calendar_duration_months, allow_multi_entry_per_day)
           VALUES ($1, $2, $3, $4, 0, 0, 'active', NOW(), NOW() + make_interval(days => $5),
             $6, $7, $8)`,
          [member.id, validPlanId, planName, remainingDays, remainingDays,
           planData.visit_quota ?? remainingDays, planData.calendar_duration_months ?? 1, planData.allow_multi_entry_per_day === true]
        );

        // Record as migrated payment (no charge)
        await client.query(
          `INSERT INTO payments (member_id, subscription_id, amount, gateway, status, processed_at, transaction_ref)
           VALUES ($1, (SELECT id FROM subscriptions WHERE member_id = $1 ORDER BY created_at DESC LIMIT 1), 0, 'cash', 'completed', NOW(), 'MIGRATED')`,
          [member.id]
        );
      }

      await client.query('COMMIT');
      res.status(201).json({ success: true, data: member });
    } catch (txErr) {
      await client.query('ROLLBACK');
      console.error('[Members] Register error:', txErr.message);
      res.status(500).json({ success: false, message: 'Internal server error.' });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[Members] Register error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT update a member
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  const { firstName, lastName, phone, isActive } = req.body;

  try {
    const existing = await query('SELECT * FROM members WHERE id = $1', [memberId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    // Check phone uniqueness if phone is being changed
    const newPhone = phone ?? existing.rows[0].phone;
    if (phone && phone !== existing.rows[0].phone) {
      const phoneCheck = await query('SELECT id FROM members WHERE phone = $1 AND id != $2', [phone, memberId]);
      if (phoneCheck.rows.length > 0) {
        return res.status(409).json({ success: false, message: 'Another member with this phone already exists.' });
      }
    }

    const m = existing.rows[0];
    const result = await query(
      `UPDATE members SET first_name = $1, last_name = $2, phone = $3, is_active = $4 WHERE id = $5 RETURNING *`,
      [firstName ?? m.first_name, lastName ?? m.last_name, newPhone, isActive !== undefined ? isActive : m.is_active, memberId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Members] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE permanently remove a member and all related data
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);

  const existing = await query('SELECT * FROM members WHERE id = $1', [memberId]).catch(() => ({ rows: [] }));
  if (existing.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Member not found.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM entry_codes WHERE member_id = $1', [memberId]);
    await client.query('DELETE FROM checkins WHERE member_id = $1', [memberId]);
    await client.query('DELETE FROM payments WHERE member_id = $1', [memberId]);
    await client.query('DELETE FROM class_enrollments WHERE member_id = $1', [memberId]);
    await client.query('DELETE FROM subscriptions WHERE member_id = $1', [memberId]);
    await client.query('DELETE FROM members WHERE id = $1', [memberId]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Members] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to delete member.' });
  } finally {
    client.release();
  }
});

// POST add days to active subscription
router.post('/:id/add-days', authenticate, authorize('admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  const { days } = req.body;

  if (!days || days < 1 || days > 365) {
    return res.status(400).json({ success: false, message: 'Days must be between 1 and 365.' });
  }

  try {
    const sub = await query(
      `SELECT id FROM subscriptions WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0 ORDER BY created_at DESC LIMIT 1`,
      [memberId]
    );

    if (sub.rows.length > 0) {
      await query('UPDATE subscriptions SET total_days = total_days + $1 WHERE id = $2', [days, sub.rows[0].id]);
    } else {
      await query(
        `INSERT INTO subscriptions (member_id, plan_name, total_days, price, status, activated_at, expires_at,
           visit_quota, calendar_duration_months, allow_multi_entry_per_day)
         VALUES ($1, 'Manual', $2, 0, 'active', NOW(), NOW() + make_interval(days => $3),
           $4, 1, false)`,
        [memberId, days, days, days]
      );
    }

    res.json({ success: true, message: `${days} days added.` });
  } catch (err) {
    console.error('[Members] Add days error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST freeze a member's active subscription (Muzlatish)
// Stores remaining calendar days at freeze time, blocks check-ins
router.post('/:id/freeze', authenticate, authorize('admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  try {
    const sub = await query(
      `SELECT id, expires_at, status, total_days, days_used FROM subscriptions
       WHERE member_id = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [memberId]
    );
    if (sub.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No active subscription to freeze.' });
    }
    const s = sub.rows[0];
    // Calendar days remaining. If expires_at is not set, use total_days - days_used as fallback
    let remainingDays;
    if (s.expires_at) {
      const remainingMs = new Date(s.expires_at) - new Date();
      remainingDays = Math.max(0, Math.ceil(remainingMs / 86400000));
    } else {
      remainingDays = Math.max(0, (s.total_days || 30) - (s.days_used || 0));
    }

    await query(
      `UPDATE subscriptions SET status = 'frozen', frozen_at = NOW(), frozen_days_saved = $1 WHERE id = $2`,
      [remainingDays, s.id]
    );
    res.json({ success: true, message: 'Subscription frozen.', daysSaved: remainingDays });
  } catch (err) {
    console.error('[Members] Freeze error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST unfreeze — extends expires_at by the banked days
router.post('/:id/unfreeze', authenticate, authorize('admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  try {
    const sub = await query(
      `SELECT id, frozen_days_saved FROM subscriptions
       WHERE member_id = $1 AND status = 'frozen'
       ORDER BY created_at DESC LIMIT 1`,
      [memberId]
    );
    if (sub.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No frozen subscription to unfreeze.' });
    }
    const saved = sub.rows[0].frozen_days_saved || 0;

    // Push expires_at forward by saved days, reset freeze fields
    await query(
      `UPDATE subscriptions SET status = 'active',
         expires_at = NOW() + ($1 * INTERVAL '1 day'),
         frozen_at = NULL, frozen_days_saved = 0
       WHERE id = $2`,
      [saved, sub.rows[0].id]
    );
    res.json({ success: true, message: 'Subscription reactivated.', extendedDays: saved });
  } catch (err) {
    console.error('[Members] Unfreeze error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST remove days from active subscription
router.post('/:id/remove-days', authenticate, authorize('admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  const { days } = req.body;

  if (!days || days < 1) {
    return res.status(400).json({ success: false, message: 'Days must be at least 1.' });
  }

  try {
    const sub = await query(
      `SELECT id, total_days, days_used FROM subscriptions WHERE member_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [memberId]
    );

    if (sub.rows.length === 0) {
      return res.status(400).json({ success: false, message: 'No active subscription.' });
    }

    const maxRemovable = sub.rows[0].total_days - sub.rows[0].days_used;
    const actual = Math.min(days, maxRemovable);
    await query('UPDATE subscriptions SET total_days = total_days - $1 WHERE id = $2', [actual, sub.rows[0].id]);

    res.json({ success: true, message: `${actual} days removed.` });
  } catch (err) {
    console.error('[Members] Remove days error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST subscribe a member to a plan (from dashboard)
router.post('/:id/subscribe', authenticate, authorize('admin'), async (req, res) => {
  const memberId = parseInt(req.params.id);
  const { planId } = req.body;

  if (!planId) {
    return res.status(400).json({ success: false, message: 'planId is required.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the member row to prevent concurrent subscription creation
    const member = await client.query('SELECT * FROM members WHERE id = $1 FOR UPDATE', [memberId]);
    if (member.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Member not found.' });
    }

    const plan = await client.query('SELECT * FROM plans WHERE id = $1', [planId]);
    if (plan.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }

    // Check for existing active subscription (safe under FOR UPDATE lock)
    const existingSub = await client.query(
      `SELECT id FROM subscriptions WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0`,
      [memberId]
    );
    if (existingSub.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Member already has an active subscription.' });
    }

    const p = plan.rows[0];

    // Create active subscription with dynamic tariff snapshot
    const sub = await client.query(
      `INSERT INTO subscriptions (member_id, plan_id, plan_name, total_days, price, status, activated_at,
         expires_at, visit_quota, calendar_duration_months, allow_multi_entry_per_day)
       VALUES ($1, $2, $3, $4, $5, 'active', NOW(),
         NOW() + (COALESCE($6, 1) * INTERVAL '1 month'), $7, $6, $8) RETURNING *`,
      [memberId, p.id, p.name, p.days, p.price,
       p.calendar_duration_months ?? 1, p.visit_quota ?? p.days, p.allow_multi_entry_per_day === true]
    );

    // Record payment
    await client.query(
      `INSERT INTO payments (member_id, subscription_id, amount, gateway, status, processed_at)
       VALUES ($1, $2, $3, 'cash', 'completed', NOW())`,
      [memberId, sub.rows[0].id, p.price]
    );

    // Update member plan
    await client.query('UPDATE members SET plan_id = $1 WHERE id = $2', [p.id, memberId]);

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: sub.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Members] Subscribe error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// POST member check-in via QR scan (from kiosk API)
router.post('/scan', authenticate, async (req, res) => {
  const { qrCodeToken } = req.body;

  if (!qrCodeToken) {
    return res.status(400).json({ success: false, message: 'Invalid QR token.' });
  }

  // QR verification is handled by the unified scan endpoint in server.js
  // This route is kept for dashboard-initiated manual checkins
  const { memberId } = req.body;
  if (!memberId) {
    return res.status(400).json({ success: false, message: 'memberId is required.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    const sub = await client.query(
      `SELECT id, total_days, days_used FROM subscriptions
       WHERE member_id = $1 AND status = 'active' AND (total_days - days_used) > 0
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [memberId]
    );

    if (sub.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'No active subscription.' });
    }

    // Check for duplicate checkin today
    const today = await client.query(
      `SELECT id FROM checkins WHERE member_id = $1
       AND checked_in_at::date = CURRENT_DATE`, [memberId]
    );
    if (today.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Already checked in today.' });
    }

    await client.query(
      'UPDATE subscriptions SET days_used = days_used + 1 WHERE id = $1',
      [sub.rows[0].id]
    );

    await client.query(
      'INSERT INTO checkins (member_id, subscription_id, approved_by_staff) VALUES ($1, $2, true)',
      [memberId, sub.rows[0].id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Check-in recorded.' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Members] Scan error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

module.exports = router;
