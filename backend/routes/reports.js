const express = require('express');
const router = express.Router();
const { query } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET summary analytics
router.get('/summary', authenticate, authorize('admin'), async (req, res) => {
  try {
    const [members, active, revenue, newThisMonth, checkins] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM members'),
      query(`SELECT COUNT(*) AS total FROM subscriptions WHERE status = 'active' AND (visit_quota IS NULL OR (total_days - days_used) > 0)`),
      query(`SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'completed'
             AND created_at >= date_trunc('month', CURRENT_DATE)`),
      query(`SELECT COUNT(*) AS total FROM members WHERE created_at >= date_trunc('month', CURRENT_DATE)`),
      query(`SELECT COUNT(*) AS total FROM checkins WHERE checked_in_at::date = CURRENT_DATE`),
    ]);

    // Expiring soon (3 days or less remaining)
    const expiring = await query(
      `SELECT COUNT(*) AS total FROM subscriptions
       WHERE status = 'active' AND visit_quota IS NOT NULL AND (total_days - days_used) BETWEEN 1 AND 3`
    );

    // Plan distribution
    const distribution = await query(
      `SELECT plan_name AS plan, COUNT(*) AS count FROM subscriptions
       WHERE status = 'active' GROUP BY plan_name`
    );

    res.json({
      success: true,
      data: {
        totalMembers: parseInt(members.rows[0].total),
        activeMembers: parseInt(active.rows[0].total),
        monthlyRevenue: parseInt(revenue.rows[0].total),
        newMembersThisMonth: parseInt(newThisMonth.rows[0].total),
        dailyCheckins: parseInt(checkins.rows[0].total),
        expiringSoon: parseInt(expiring.rows[0].total),
        planDistribution: distribution.rows,
      },
    });
  } catch (err) {
    console.error('[Reports] Summary error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET monthly revenue breakdown (last 6 months)
router.get('/revenue', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT to_char(date_trunc('month', created_at), 'Mon') AS month,
        COALESCE(SUM(amount), 0) AS revenue
      FROM payments
      WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '6 months'
      GROUP BY date_trunc('month', created_at)
      ORDER BY date_trunc('month', created_at)
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Reports] Revenue error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET visit heatmap (hourly check-ins for today)
router.get('/visits/heatmap', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT EXTRACT(HOUR FROM checked_in_at) AS hour, COUNT(*) AS visits
      FROM checkins
      WHERE checked_in_at::date = CURRENT_DATE
      GROUP BY EXTRACT(HOUR FROM checked_in_at)
      ORDER BY hour
    `);

    // Fill all hours 6-22
    const hours = [];
    const hourMap = {};
    result.rows.forEach(r => { hourMap[parseInt(r.hour)] = parseInt(r.visits); });
    for (let h = 6; h <= 22; h++) {
      hours.push({ hour: `${String(h).padStart(2, '0')}:00`, visits: hourMap[h] || 0 });
    }

    res.json({ success: true, data: hours });
  } catch (err) {
    console.error('[Reports] Heatmap error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET today's check-ins with member info
router.get('/today-checkins', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT c.id, c.checked_in_at, m.first_name, m.last_name, m.phone,
        COALESCE(p.name, 'none') AS plan
      FROM checkins c
      JOIN members m ON m.id = c.member_id
      LEFT JOIN plans p ON p.id = m.plan_id
      WHERE c.checked_in_at::date = CURRENT_DATE
      ORDER BY c.checked_in_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Reports] Today checkins error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET debtors list — admin only
router.get('/debtors', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT m.id, m.first_name, m.last_name, m.phone,
        s.total_days, s.days_used, s.expires_at
      FROM members m
      JOIN subscriptions s ON s.member_id = m.id
      WHERE s.status = 'active' AND s.visit_quota IS NOT NULL AND (s.total_days - s.days_used) <= 0
      ORDER BY s.expires_at ASC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Reports] Debtors error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
