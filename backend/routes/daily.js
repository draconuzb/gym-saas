const express = require('express');
const router = express.Router();
const { query } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET today's daily visits
router.get('/', authenticate, async (req, res) => {
  try {
    const { date } = req.query;

    // Validate date format if provided
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    let sql, params;
    if (date) {
      sql = `SELECT * FROM daily_visits WHERE visited_at::date = $1 ORDER BY visited_at DESC`;
      params = [date];
    } else {
      sql = `SELECT * FROM daily_visits WHERE visited_at::date = CURRENT_DATE ORDER BY visited_at DESC`;
      params = [];
    }

    const result = await query(sql, params);

    // Also get today's summary
    const summaryResult = await query(
      date
        ? `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM daily_visits WHERE visited_at::date = $1`
        : `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total FROM daily_visits WHERE visited_at::date = CURRENT_DATE`,
      date ? [date] : []
    );

    res.json({
      success: true,
      data: result.rows,
      summary: {
        count: parseInt(summaryResult.rows[0].count),
        total: parseInt(summaryResult.rows[0].total),
      },
    });
  } catch (err) {
    console.error('[Daily] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST register a daily walk-in visitor
router.post('/', authenticate, async (req, res) => {
  const { visitorName, phone, amount, paymentMethod, notes } = req.body;

  if (amount === undefined || amount === null || amount <= 0 || amount > 10000000) {
    return res.status(400).json({ success: false, message: 'Amount must be between 1 and 10,000,000.' });
  }

  try {
    const result = await query(
      `INSERT INTO daily_visits (visitor_name, phone, amount, payment_method, notes, registered_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        visitorName || null,
        phone || null,
        amount,
        paymentMethod || 'cash',
        notes || '',
        req.user?.id || null,
      ]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Daily] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE remove a daily visit entry
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query('DELETE FROM daily_visits WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Visit not found.' });
    }
    res.json({ success: true, message: 'Visit removed.' });
  } catch (err) {
    console.error('[Daily] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET daily visits stats for reports (last 30 days)
router.get('/stats', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT visited_at::date AS date, COUNT(*) AS visitors, COALESCE(SUM(amount), 0) AS revenue
      FROM daily_visits
      WHERE visited_at >= NOW() - INTERVAL '30 days'
      GROUP BY visited_at::date
      ORDER BY visited_at::date DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Daily] Stats error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
