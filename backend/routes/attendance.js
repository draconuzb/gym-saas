const express = require('express');
const router = express.Router();
const { query } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET attendance for a specific date (default: today)
router.get('/', authenticate, async (req, res) => {
  try {
    const { date } = req.query;

    // Validate date format if provided
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    const targetDate = date || null;

    let sql, params;
    if (targetDate) {
      sql = `
        SELECT c.id, c.checked_in_at, c.member_id,
          m.first_name, m.last_name, m.phone, m.telegram_id,
          COALESCE(p.name, 'none') AS plan,
          s.total_days, s.days_used
        FROM checkins c
        JOIN members m ON m.id = c.member_id
        LEFT JOIN plans p ON p.id = m.plan_id
        LEFT JOIN subscriptions s ON s.id = c.subscription_id
        WHERE c.checked_in_at::date = $1
        ORDER BY c.checked_in_at DESC
      `;
      params = [targetDate];
    } else {
      sql = `
        SELECT c.id, c.checked_in_at, c.member_id,
          m.first_name, m.last_name, m.phone, m.telegram_id,
          COALESCE(p.name, 'none') AS plan,
          s.total_days, s.days_used
        FROM checkins c
        JOIN members m ON m.id = c.member_id
        LEFT JOIN plans p ON p.id = m.plan_id
        LEFT JOIN subscriptions s ON s.id = c.subscription_id
        WHERE c.checked_in_at::date = CURRENT_DATE
        ORDER BY c.checked_in_at DESC
      `;
      params = [];
    }

    const result = await query(sql, params);

    // Summary
    const uniqueMembers = new Set(result.rows.map(r => r.member_id));

    res.json({
      success: true,
      data: result.rows,
      summary: {
        totalCheckins: result.rows.length,
        uniqueMembers: uniqueMembers.size,
      },
    });
  } catch (err) {
    console.error('[Attendance] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET attendance history for a member
router.get('/member/:id', authenticate, async (req, res) => {
  try {
    const memberId = parseInt(req.params.id);
    const result = await query(`
      SELECT c.id, c.checked_in_at
      FROM checkins c
      WHERE c.member_id = $1
      ORDER BY c.checked_in_at DESC
      LIMIT 100
    `, [memberId]);

    const total = await query('SELECT COUNT(*) AS n FROM checkins WHERE member_id = $1', [memberId]);

    res.json({
      success: true,
      data: result.rows,
      total: parseInt(total.rows[0].n),
    });
  } catch (err) {
    console.error('[Attendance] Member history error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET member segments: expired not renewed + churned
router.get('/segments', authenticate, authorize('admin'), async (req, res) => {
  try {
    const { segment } = req.query;

    let sql;
    if (segment === 'expired') {
      // Members whose subscription expired and haven't renewed
      sql = `
        SELECT m.id, m.first_name, m.last_name, m.phone, m.telegram_id, m.created_at,
          COALESCE(p.name, 'none') AS plan,
          s.plan_name AS last_plan, s.expires_at AS expired_at,
          s.created_at AS sub_created_at
        FROM members m
        LEFT JOIN plans p ON p.id = m.plan_id
        JOIN subscriptions s ON s.member_id = m.id
        WHERE s.status IN ('expired', 'cancelled')
          AND m.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions s2
            WHERE s2.member_id = m.id AND s2.status = 'active' AND (s2.visit_quota IS NULL OR (s2.total_days - s2.days_used) > 0)
          )
          AND s.created_at = (
            SELECT MAX(s3.created_at) FROM subscriptions s3 WHERE s3.member_id = m.id
          )
        ORDER BY s.expires_at DESC
      `;
    } else if (segment === 'churned') {
      // Members who had subscriptions but stopped renewing (last activity > 30 days ago)
      sql = `
        SELECT m.id, m.first_name, m.last_name, m.phone, m.telegram_id, m.created_at,
          COALESCE(p.name, 'none') AS plan,
          s.plan_name AS last_plan,
          s.created_at AS last_sub_date,
          (SELECT MAX(c.checked_in_at) FROM checkins c WHERE c.member_id = m.id) AS last_visit
        FROM members m
        LEFT JOIN plans p ON p.id = m.plan_id
        JOIN subscriptions s ON s.member_id = m.id
        WHERE m.is_active = true
          AND NOT EXISTS (
            SELECT 1 FROM subscriptions s2
            WHERE s2.member_id = m.id AND s2.status = 'active' AND (s2.visit_quota IS NULL OR (s2.total_days - s2.days_used) > 0)
          )
          AND s.created_at = (
            SELECT MAX(s3.created_at) FROM subscriptions s3 WHERE s3.member_id = m.id
          )
          AND s.created_at < NOW() - INTERVAL '30 days'
        ORDER BY s.created_at DESC
      `;
    } else if (segment === 'never_subscribed') {
      // Registered but never bought any subscription
      sql = `
        SELECT m.id, m.first_name, m.last_name, m.phone, m.telegram_id, m.created_at,
          'none' AS plan, NULL AS last_plan, NULL AS last_visit
        FROM members m
        WHERE m.is_active = true
          AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.member_id = m.id)
        ORDER BY m.created_at DESC
      `;
    } else {
      return res.status(400).json({ success: false, message: 'segment must be: expired, churned, or never_subscribed' });
    }

    // H3 fix: Parameterized LIMIT/OFFSET with total count
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    // Get total count first (same query without LIMIT/OFFSET)
    const countResult = await query(`SELECT COUNT(*) AS total FROM (${sql}) _count`);
    const total = parseInt(countResult.rows[0].total);

    sql += ` LIMIT $1 OFFSET $2`;
    const result = await query(sql, [limit, offset]);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      total,
      page,
      limit,
      segment,
    });
  } catch (err) {
    console.error('[Attendance] Segments error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET loyalty analytics: 3mo, 6mo, 1yr members
// H4 fix: added LIMIT to prevent unbounded queries
router.get('/loyalty', authenticate, authorize('admin'), async (req, res) => {
  try {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
    const [threeMonths, sixMonths, oneYear] = await Promise.all([
      query(`
        SELECT m.id, m.first_name, m.last_name, m.phone, m.telegram_id, m.created_at,
          COALESCE(p.name, 'none') AS plan,
          (SELECT COUNT(*) FROM checkins c WHERE c.member_id = m.id) AS total_visits,
          (SELECT MAX(c.checked_in_at) FROM checkins c WHERE c.member_id = m.id) AS last_visit
        FROM members m
        LEFT JOIN plans p ON p.id = m.plan_id
        WHERE m.created_at <= NOW() - INTERVAL '3 months'
          AND m.created_at > NOW() - INTERVAL '6 months'
          AND m.is_active = true
        ORDER BY m.created_at ASC
        LIMIT $1
      `, [limit]),
      query(`
        SELECT m.id, m.first_name, m.last_name, m.phone, m.telegram_id, m.created_at,
          COALESCE(p.name, 'none') AS plan,
          (SELECT COUNT(*) FROM checkins c WHERE c.member_id = m.id) AS total_visits,
          (SELECT MAX(c.checked_in_at) FROM checkins c WHERE c.member_id = m.id) AS last_visit
        FROM members m
        LEFT JOIN plans p ON p.id = m.plan_id
        WHERE m.created_at <= NOW() - INTERVAL '6 months'
          AND m.created_at > NOW() - INTERVAL '1 year'
          AND m.is_active = true
        ORDER BY m.created_at ASC
        LIMIT $1
      `, [limit]),
      query(`
        SELECT m.id, m.first_name, m.last_name, m.phone, m.telegram_id, m.created_at,
          COALESCE(p.name, 'none') AS plan,
          (SELECT COUNT(*) FROM checkins c WHERE c.member_id = m.id) AS total_visits,
          (SELECT MAX(c.checked_in_at) FROM checkins c WHERE c.member_id = m.id) AS last_visit
        FROM members m
        LEFT JOIN plans p ON p.id = m.plan_id
        WHERE m.created_at <= NOW() - INTERVAL '1 year'
          AND m.is_active = true
        ORDER BY m.created_at ASC
        LIMIT $1
      `, [limit]),
    ]);

    res.json({
      success: true,
      data: {
        threeMonths: { members: threeMonths.rows, count: threeMonths.rows.length },
        sixMonths: { members: sixMonths.rows, count: sixMonths.rows.length },
        oneYear: { members: oneYear.rows, count: oneYear.rows.length },
      },
    });
  } catch (err) {
    console.error('[Attendance] Loyalty error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
