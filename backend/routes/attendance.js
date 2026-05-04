const express = require('express');
const router = express.Router();
const { withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

router.use(authenticate, requireGym);

// GET attendance for a specific date (default: today)
router.get('/', async (req, res) => {
  const { date } = req.query;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const filter = date ? `c.checked_in_at::date = $1` : `c.checked_in_at::date = CURRENT_DATE`;
      const params = date ? [date] : [];
      const r = await db.query(`
        SELECT c.id, c.checked_in_at, c.member_id,
          m.first_name, m.last_name, m.phone, m.telegram_id,
          COALESCE(p.name, 'none') AS plan,
          s.total_days, s.days_used
        FROM checkins c
        JOIN members m ON m.id = c.member_id
        LEFT JOIN plans p ON p.id = m.plan_id
        LEFT JOIN subscriptions s ON s.id = c.subscription_id
        WHERE ${filter}
        ORDER BY c.checked_in_at DESC`, params);
      const uniqueMembers = new Set(r.rows.map(row => row.member_id));
      return { rows: r.rows, totalCheckins: r.rows.length, uniqueMembers: uniqueMembers.size };
    });
    res.json({
      success: true,
      data: out.rows,
      summary: { totalCheckins: out.totalCheckins, uniqueMembers: out.uniqueMembers },
    });
  } catch (err) {
    console.error('[Attendance] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET history for a member
router.get('/member/:id', async (req, res) => {
  const memberId = parseInt(req.params.id);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid member id.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const [list, total] = await Promise.all([
        db.query(`SELECT c.id, c.checked_in_at FROM checkins c WHERE c.member_id = $1 ORDER BY c.checked_in_at DESC LIMIT 100`, [memberId]),
        db.query('SELECT COUNT(*) AS n FROM checkins WHERE member_id = $1', [memberId]),
      ]);
      return { rows: list.rows, total: parseInt(total.rows[0].n) };
    });
    res.json({ success: true, data: out.rows, total: out.total });
  } catch (err) {
    console.error('[Attendance] Member history error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET segments — admin only
router.get('/segments', authorize('admin', 'super_admin'), async (req, res) => {
  const { segment } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
  const offset = (page - 1) * limit;

  let sql;
  if (segment === 'expired') {
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
          WHERE s2.member_id = m.id AND s2.status = 'active'
            AND (s2.visit_quota IS NULL OR (s2.total_days - s2.days_used) > 0)
        )
        AND s.created_at = (
          SELECT MAX(s3.created_at) FROM subscriptions s3 WHERE s3.member_id = m.id
        )
      ORDER BY s.expires_at DESC`;
  } else if (segment === 'churned') {
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
          WHERE s2.member_id = m.id AND s2.status = 'active'
            AND (s2.visit_quota IS NULL OR (s2.total_days - s2.days_used) > 0)
        )
        AND s.created_at = (
          SELECT MAX(s3.created_at) FROM subscriptions s3 WHERE s3.member_id = m.id
        )
        AND s.created_at < NOW() - INTERVAL '30 days'
      ORDER BY s.created_at DESC`;
  } else if (segment === 'never_subscribed') {
    sql = `
      SELECT m.id, m.first_name, m.last_name, m.phone, m.telegram_id, m.created_at,
        'none' AS plan, NULL AS last_plan, NULL AS last_visit
      FROM members m
      WHERE m.is_active = true
        AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.member_id = m.id)
      ORDER BY m.created_at DESC`;
  } else {
    return res.status(400).json({ success: false, message: 'segment must be: expired, churned, or never_subscribed' });
  }

  try {
    const out = await withGym(req.gymId, async (db) => {
      const countResult = await db.query(`SELECT COUNT(*) AS total FROM (${sql}) _count`);
      const total = parseInt(countResult.rows[0].total);
      const r = await db.query(`${sql} LIMIT $1 OFFSET $2`, [limit, offset]);
      return { rows: r.rows, total };
    });
    res.json({
      success: true,
      data: out.rows,
      count: out.rows.length,
      total: out.total,
      page, limit, segment,
    });
  } catch (err) {
    console.error('[Attendance] Segments error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET loyalty analytics — admin only
router.get('/loyalty', authorize('admin', 'super_admin'), async (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
  const baseSelect = (interval) => `
    SELECT m.id, m.first_name, m.last_name, m.phone, m.telegram_id, m.created_at,
      COALESCE(p.name, 'none') AS plan,
      (SELECT COUNT(*) FROM checkins c WHERE c.member_id = m.id) AS total_visits,
      (SELECT MAX(c.checked_in_at) FROM checkins c WHERE c.member_id = m.id) AS last_visit
    FROM members m
    LEFT JOIN plans p ON p.id = m.plan_id
    WHERE ${interval} AND m.is_active = true
    ORDER BY m.created_at ASC
    LIMIT $1`;
  try {
    const out = await withGym(req.gymId, async (db) => {
      const [threeMonths, sixMonths, oneYear] = await Promise.all([
        db.query(baseSelect(`m.created_at <= NOW() - INTERVAL '3 months' AND m.created_at > NOW() - INTERVAL '6 months'`), [limit]),
        db.query(baseSelect(`m.created_at <= NOW() - INTERVAL '6 months' AND m.created_at > NOW() - INTERVAL '1 year'`), [limit]),
        db.query(baseSelect(`m.created_at <= NOW() - INTERVAL '1 year'`), [limit]),
      ]);
      return {
        threeMonths: { members: threeMonths.rows, count: threeMonths.rows.length },
        sixMonths:   { members: sixMonths.rows,   count: sixMonths.rows.length },
        oneYear:     { members: oneYear.rows,     count: oneYear.rows.length },
      };
    });
    res.json({ success: true, data: out });
  } catch (err) {
    console.error('[Attendance] Loyalty error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
