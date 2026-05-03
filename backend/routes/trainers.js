const express = require('express');
const router = express.Router();
const { query } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET all trainers
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT t.id, t.first_name, t.last_name, t.specialty, t.phone, t.is_active, t.created_at,
        COUNT(DISTINCT c.id) AS class_count,
        COUNT(DISTINCT ce.id) AS total_sessions
       FROM trainers t
       LEFT JOIN classes c ON c.trainer_id = t.id
       LEFT JOIN class_enrollments ce ON ce.class_id = c.id
       WHERE t.is_active = true
       GROUP BY t.id
       ORDER BY t.first_name`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Trainers] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET trainer by id with their classes
router.get('/:id', authenticate, async (req, res) => {
  try {
    const trainerId = parseInt(req.params.id);
    const trainerResult = await query(
      'SELECT * FROM trainers WHERE id = $1', [trainerId]
    );
    if (trainerResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Trainer not found.' });
    }

    const classesResult = await query(
      `SELECT c.id, c.name, c.day_of_week, c.start_time, c.capacity,
        COUNT(ce.id) AS enrolled
       FROM classes c
       LEFT JOIN class_enrollments ce ON ce.class_id = c.id
       WHERE c.trainer_id = $1
       GROUP BY c.id
       ORDER BY c.day_of_week, c.start_time`, [trainerId]
    );

    res.json({
      success: true,
      data: { ...trainerResult.rows[0], classes: classesResult.rows },
    });
  } catch (err) {
    console.error('[Trainers] Profile error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST add a new trainer — admin only
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const { firstName, lastName, specialty, phone } = req.body;
  if (!firstName || !specialty) {
    return res.status(400).json({ success: false, message: 'firstName and specialty are required.' });
  }

  try {
    const result = await query(
      `INSERT INTO trainers (first_name, last_name, specialty, phone)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [firstName, lastName || null, specialty, phone || null]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Trainers] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT update a trainer — admin only
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  const { firstName, lastName, specialty, phone, isActive } = req.body;
  try {
    const result = await query(
      `UPDATE trainers SET
        first_name = COALESCE($2, first_name),
        last_name = COALESCE($3, last_name),
        specialty = COALESCE($4, specialty),
        phone = COALESCE($5, phone),
        is_active = COALESCE($6, is_active)
       WHERE id = $1 RETURNING *`,
      [parseInt(req.params.id), firstName, lastName, specialty, phone, isActive]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Trainer not found.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Trainers] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE remove a trainer — admin only
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query(
      'UPDATE trainers SET is_active = false WHERE id = $1 RETURNING id',
      [parseInt(req.params.id)]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Trainer not found.' });
    }
    res.json({ success: true, message: 'Trainer deactivated.' });
  } catch (err) {
    console.error('[Trainers] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
