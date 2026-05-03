const express = require('express');
const router = express.Router();
const { query, getClient } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET all classes with enrollment counts
router.get('/', authenticate, async (req, res) => {
  try {
    const { day } = req.query;
    let sql = `
      SELECT c.id, c.name, c.day_of_week, c.start_time, c.capacity,
        t.first_name AS trainer_name, t.id AS trainer_id,
        COUNT(ce.id) AS enrolled
      FROM classes c
      LEFT JOIN trainers t ON t.id = c.trainer_id
      LEFT JOIN class_enrollments ce ON ce.class_id = c.id
    `;
    const params = [];

    if (day) {
      params.push(day);
      sql += ` WHERE c.day_of_week = $1`;
    }

    sql += ' GROUP BY c.id, t.id ORDER BY c.day_of_week, c.start_time';

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Classes] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET single class by id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT c.*, t.first_name AS trainer_name,
        COUNT(ce.id) AS enrolled
       FROM classes c
       LEFT JOIN trainers t ON t.id = c.trainer_id
       LEFT JOIN class_enrollments ce ON ce.class_id = c.id
       WHERE c.id = $1
       GROUP BY c.id, t.id`,
      [parseInt(req.params.id)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Class not found.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Classes] Get error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST create a new class — admin only
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const { name, trainerId, dayOfWeek, startTime, capacity } = req.body;
  if (!name || !trainerId || !dayOfWeek || !startTime) {
    return res.status(400).json({ success: false, message: 'name, trainerId, dayOfWeek, startTime are required.' });
  }

  try {
    const result = await query(
      `INSERT INTO classes (name, trainer_id, day_of_week, start_time, capacity)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, trainerId, dayOfWeek, startTime, capacity || 15]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Classes] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST enroll a member in a class
router.post('/:id/enroll', authenticate, async (req, res) => {
  const classId = parseInt(req.params.id);
  const { memberId } = req.body;

  if (!memberId) {
    return res.status(400).json({ success: false, message: 'memberId is required.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the class row to prevent race conditions on capacity
    const clsRow = await client.query('SELECT * FROM classes WHERE id = $1 FOR UPDATE', [classId]);
    if (clsRow.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Class not found.' });
    }

    // Check capacity within the transaction
    const enrollCount = await client.query(
      'SELECT COUNT(*)::int AS enrolled FROM class_enrollments WHERE class_id = $1', [classId]
    );

    if (enrollCount.rows[0].enrolled >= clsRow.rows[0].capacity) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Class is fully booked.' });
    }

    await client.query(
      'INSERT INTO class_enrollments (class_id, member_id) VALUES ($1, $2)',
      [classId, memberId]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Enrolled successfully.' });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') { // unique_violation
      return res.status(409).json({ success: false, message: 'Already enrolled in this class.' });
    }
    console.error('[Classes] Enroll error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// DELETE unenroll a member from a class
router.delete('/:id/enroll/:memberId', authenticate, async (req, res) => {
  const classId = parseInt(req.params.id);
  const memberId = parseInt(req.params.memberId);
  try {
    const result = await query(
      'DELETE FROM class_enrollments WHERE class_id = $1 AND member_id = $2',
      [classId, memberId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Enrollment not found.' });
    }
    res.json({ success: true, message: 'Unenrolled successfully.' });
  } catch (err) {
    console.error('[Classes] Unenroll error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE a class — admin only
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query('DELETE FROM classes WHERE id = $1 RETURNING id', [parseInt(req.params.id)]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Class not found.' });
    }
    res.json({ success: true, message: 'Class deleted.' });
  } catch (err) {
    console.error('[Classes] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
