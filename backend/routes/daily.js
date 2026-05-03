const express = require('express');
const router = express.Router();
const { withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

router.use(authenticate, requireGym);

// GET today's daily visits (or for ?date=YYYY-MM-DD)
router.get('/', async (req, res) => {
  const { date } = req.query;
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
  }

  try {
    const out = await withGym(req.gymId, async (db) => {
      const listSql = date
        ? `SELECT * FROM daily_visits WHERE visited_at::date = $1 ORDER BY visited_at DESC`
        : `SELECT * FROM daily_visits WHERE visited_at::date = CURRENT_DATE ORDER BY visited_at DESC`;
      const sumSql = date
        ? `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM daily_visits WHERE visited_at::date = $1`
        : `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM daily_visits WHERE visited_at::date = CURRENT_DATE`;
      const params = date ? [date] : [];
      const [list, sum] = await Promise.all([db.query(listSql, params), db.query(sumSql, params)]);
      return {
        data: list.rows,
        summary: {
          count: parseInt(sum.rows[0].count),
          total: parseInt(sum.rows[0].total),
        },
      };
    });
    res.json({ success: true, ...out });
  } catch (err) {
    console.error('[Daily] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST register walk-in visitor
router.post('/', async (req, res) => {
  const { visitorName, phone, amount, paymentMethod, notes } = req.body;
  if (amount === undefined || amount === null || amount <= 0 || amount > 10000000) {
    return res.status(400).json({ success: false, message: 'Amount must be between 1 and 10,000,000.' });
  }

  try {
    const row = await withGym(req.gymId, async (db) => {
      const r = await db.query(
        `INSERT INTO daily_visits (gym_id, visitor_name, phone, amount, payment_method, notes, registered_by)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          visitorName || null,
          phone || null,
          amount,
          paymentMethod || 'cash',
          notes || '',
          req.user?.id || null,
        ]
      );
      return r.rows[0];
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('[Daily] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE — admin only
router.delete('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid id.' });
  }
  try {
    const count = await withGym(req.gymId, async (db) => {
      const r = await db.query('DELETE FROM daily_visits WHERE id = $1 RETURNING id', [id]);
      return r.rowCount;
    });
    if (count === 0) return res.status(404).json({ success: false, message: 'Visit not found.' });
    res.json({ success: true, message: 'Visit removed.' });
  } catch (err) {
    console.error('[Daily] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET 30-day stats
router.get('/stats', async (req, res) => {
  try {
    const data = await withGym(req.gymId, async (db) => {
      const r = await db.query(`
        SELECT visited_at::date AS date, COUNT(*) AS visitors, COALESCE(SUM(amount), 0) AS revenue
        FROM daily_visits
        WHERE visited_at >= NOW() - INTERVAL '30 days'
        GROUP BY visited_at::date
        ORDER BY visited_at::date DESC
      `);
      return r.rows;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Daily] Stats error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
