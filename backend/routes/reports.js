const express = require('express');
const router = express.Router();
const { withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

router.use(authenticate, requireGym, authorize('admin', 'super_admin'));

// GET summary analytics
router.get('/summary', async (req, res) => {
  try {
    const data = await withGym(req.gymId, async (db) => {
      const [members, active, revenue, newThisMonth, checkins, expiring, distribution] =
        await Promise.all([
          db.query('SELECT COUNT(*) AS total FROM members'),
          db.query(`SELECT COUNT(*) AS total FROM subscriptions
                    WHERE status = 'active' AND (visit_quota IS NULL OR (total_days - days_used) > 0)`),
          // Monthly revenue = subscription/cash payments + daily walk-in visits.
          db.query(`SELECT
                      (SELECT COALESCE(SUM(amount), 0) FROM payments
                         WHERE status = 'completed'
                           AND created_at >= date_trunc('month', CURRENT_DATE))
                    + (SELECT COALESCE(SUM(amount), 0) FROM daily_visits
                         WHERE visited_at >= date_trunc('month', CURRENT_DATE))
                    AS total`),
          db.query(`SELECT COUNT(*) AS total FROM members WHERE created_at >= date_trunc('month', CURRENT_DATE)`),
          db.query(`SELECT COUNT(*) AS total FROM checkins WHERE checked_in_at::date = CURRENT_DATE`),
          db.query(`SELECT COUNT(*) AS total FROM subscriptions
                    WHERE status = 'active' AND visit_quota IS NOT NULL
                      AND (total_days - days_used) BETWEEN 1 AND 3`),
          db.query(`SELECT plan_name AS plan, COUNT(*) AS count FROM subscriptions
                    WHERE status = 'active' GROUP BY plan_name`),
        ]);
      return {
        totalMembers: parseInt(members.rows[0].total),
        activeMembers: parseInt(active.rows[0].total),
        monthlyRevenue: parseInt(revenue.rows[0].total),
        newMembersThisMonth: parseInt(newThisMonth.rows[0].total),
        dailyCheckins: parseInt(checkins.rows[0].total),
        expiringSoon: parseInt(expiring.rows[0].total),
        planDistribution: distribution.rows,
      };
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Reports] Summary error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET monthly revenue (last 6 months) — payments + daily visits combined
router.get('/revenue', async (req, res) => {
  try {
    const data = await withGym(req.gymId, async (db) => {
      const r = await db.query(`
        WITH combined AS (
          SELECT date_trunc('month', created_at) AS m, amount
          FROM payments
          WHERE status = 'completed' AND created_at >= NOW() - INTERVAL '6 months'
          UNION ALL
          SELECT date_trunc('month', visited_at) AS m, amount
          FROM daily_visits
          WHERE visited_at >= NOW() - INTERVAL '6 months'
        )
        SELECT to_char(m, 'Mon') AS month, COALESCE(SUM(amount), 0) AS revenue
        FROM combined
        GROUP BY m
        ORDER BY m
      `);
      return r.rows;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Reports] Revenue error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET hourly heatmap of today's check-ins (06:00–22:00)
router.get('/visits/heatmap', async (req, res) => {
  try {
    const data = await withGym(req.gymId, async (db) => {
      const r = await db.query(`
        SELECT EXTRACT(HOUR FROM checked_in_at)::int AS hour, COUNT(*)::int AS visits
        FROM checkins
        WHERE checked_in_at::date = CURRENT_DATE
        GROUP BY EXTRACT(HOUR FROM checked_in_at)
        ORDER BY hour`);
      const hourMap = {};
      r.rows.forEach(row => { hourMap[row.hour] = row.visits; });
      const hours = [];
      for (let h = 6; h <= 22; h++) {
        hours.push({ hour: `${String(h).padStart(2, '0')}:00`, visits: hourMap[h] || 0 });
      }
      return hours;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Reports] Heatmap error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET today's check-ins with member info
router.get('/today-checkins', async (req, res) => {
  try {
    const data = await withGym(req.gymId, async (db) => {
      const r = await db.query(`
        SELECT c.id, c.checked_in_at, m.first_name, m.last_name, m.phone,
          COALESCE(p.name, 'none') AS plan
        FROM checkins c
        JOIN members m ON m.id = c.member_id
        LEFT JOIN plans p ON p.id = m.plan_id
        WHERE c.checked_in_at::date = CURRENT_DATE
        ORDER BY c.checked_in_at DESC`);
      return r.rows;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Reports] Today checkins error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET debtors list
router.get('/debtors', async (req, res) => {
  try {
    const data = await withGym(req.gymId, async (db) => {
      const r = await db.query(`
        SELECT m.id, m.first_name, m.last_name, m.phone,
          s.total_days, s.days_used, s.expires_at
        FROM members m
        JOIN subscriptions s ON s.member_id = m.id
        WHERE s.status = 'active' AND s.visit_quota IS NOT NULL
          AND (s.total_days - s.days_used) <= 0
        ORDER BY s.expires_at ASC`);
      return r.rows;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Reports] Debtors error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
