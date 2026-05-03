const express = require('express');
const router = express.Router();
const { withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

router.use(authenticate, requireGym);

// GET all active trainers (with class/session counts)
router.get('/', async (req, res) => {
  try {
    const data = await withGym(req.gymId, async (db) => {
      const r = await db.query(
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
      return r.rows;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Trainers] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET trainer by id with their classes
router.get('/:id', async (req, res) => {
  const trainerId = parseInt(req.params.id);
  if (!Number.isInteger(trainerId) || trainerId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid trainer id.' });
  }
  try {
    const data = await withGym(req.gymId, async (db) => {
      const trainerResult = await db.query('SELECT * FROM trainers WHERE id = $1', [trainerId]);
      if (trainerResult.rows.length === 0) return null;
      const classesResult = await db.query(
        `SELECT c.id, c.name, c.day_of_week, c.start_time, c.capacity,
          COUNT(ce.id) AS enrolled
         FROM classes c
         LEFT JOIN class_enrollments ce ON ce.class_id = c.id
         WHERE c.trainer_id = $1
         GROUP BY c.id
         ORDER BY c.day_of_week, c.start_time`, [trainerId]
      );
      return { ...trainerResult.rows[0], classes: classesResult.rows };
    });
    if (!data) return res.status(404).json({ success: false, message: 'Trainer not found.' });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Trainers] Profile error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST add trainer — admin only
router.post('/', authorize('admin', 'super_admin'), async (req, res) => {
  const { firstName, lastName, specialty, phone } = req.body;
  if (!firstName || !specialty) {
    return res.status(400).json({ success: false, message: 'firstName and specialty are required.' });
  }
  try {
    const row = await withGym(req.gymId, async (db) => {
      const r = await db.query(
        `INSERT INTO trainers (gym_id, first_name, last_name, specialty, phone)
         VALUES (current_gym_id(), $1, $2, $3, $4) RETURNING *`,
        [firstName, lastName || null, specialty, phone || null]
      );
      return r.rows[0];
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('[Trainers] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT update trainer — admin only
router.put('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid id.' });
  }
  const { firstName, lastName, specialty, phone, isActive } = req.body;
  try {
    const row = await withGym(req.gymId, async (db) => {
      const r = await db.query(
        `UPDATE trainers SET
           first_name = COALESCE($2, first_name),
           last_name = COALESCE($3, last_name),
           specialty = COALESCE($4, specialty),
           phone = COALESCE($5, phone),
           is_active = COALESCE($6, is_active)
         WHERE id = $1 RETURNING *`,
        [id, firstName, lastName, specialty, phone, isActive]
      );
      return r.rows[0] || null;
    });
    if (!row) return res.status(404).json({ success: false, message: 'Trainer not found.' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[Trainers] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE — soft-delete (sets is_active=false). Admin only.
router.delete('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid id.' });
  }
  try {
    const found = await withGym(req.gymId, async (db) => {
      const r = await db.query(
        'UPDATE trainers SET is_active = false WHERE id = $1 RETURNING id',
        [id]
      );
      return r.rowCount;
    });
    if (!found) return res.status(404).json({ success: false, message: 'Trainer not found.' });
    res.json({ success: true, message: 'Trainer deactivated.' });
  } catch (err) {
    console.error('[Trainers] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
