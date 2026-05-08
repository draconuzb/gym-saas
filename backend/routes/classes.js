const express = require('express');
const router = express.Router();
const { withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

router.use(authenticate, requireGym);

// GET classes (optionally filter by ?day=Mon)
router.get('/', async (req, res) => {
  const { day } = req.query;
  try {
    const data = await withGym(req.gymId, async (db) => {
      let sql = `
        SELECT c.id, c.name, c.day_of_week, c.start_time, c.capacity,
          t.first_name AS trainer_name, t.id AS trainer_id,
          COUNT(ce.id) AS enrolled
        FROM classes c
        LEFT JOIN trainers t ON t.id = c.trainer_id
        LEFT JOIN class_enrollments ce ON ce.class_id = c.id`;
      const params = [];
      if (day) {
        sql += ` WHERE c.day_of_week = $1`;
        params.push(day);
      }
      sql += ' GROUP BY c.id, t.id ORDER BY c.day_of_week, c.start_time';
      const r = await db.query(sql, params);
      return r.rows;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Classes] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET single class
router.get('/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid id.' });
  }
  try {
    const row = await withGym(req.gymId, async (db) => {
      const r = await db.query(
        `SELECT c.*, t.first_name AS trainer_name,
          COUNT(ce.id) AS enrolled
         FROM classes c
         LEFT JOIN trainers t ON t.id = c.trainer_id
         LEFT JOIN class_enrollments ce ON ce.class_id = c.id
         WHERE c.id = $1
         GROUP BY c.id, t.id`,
        [id]
      );
      return r.rows[0] || null;
    });
    if (!row) return res.status(404).json({ success: false, message: 'Class not found.' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[Classes] Get error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST create class — admin only
const VALID_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

router.post('/', authorize('admin', 'super_admin'), async (req, res) => {
  const { name, trainerId, dayOfWeek, startTime, capacity } = req.body;
  if (!name || !trainerId || !dayOfWeek || !startTime) {
    return res.status(400).json({ success: false, message: 'name, trainerId, dayOfWeek, startTime are required.' });
  }
  if (!VALID_DAYS.includes(dayOfWeek)) {
    return res.status(400).json({ success: false, message: `dayOfWeek must be one of: ${VALID_DAYS.join(', ')}.` });
  }
  try {
    const row = await withGym(req.gymId, async (db) => {
      const r = await db.query(
        `INSERT INTO classes (gym_id, name, trainer_id, day_of_week, start_time, capacity)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5) RETURNING *`,
        [name, trainerId, dayOfWeek, startTime, capacity || 15]
      );
      return r.rows[0];
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('[Classes] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST enroll a member — capacity-checked under row lock
router.post('/:id/enroll', async (req, res) => {
  const classId = parseInt(req.params.id);
  const { memberId } = req.body;
  if (!Number.isInteger(classId) || classId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid class id.' });
  }
  if (!memberId) {
    return res.status(400).json({ success: false, message: 'memberId is required.' });
  }

  try {
    const result = await withGym(req.gymId, async (db) => {
      const clsRow = await db.query('SELECT * FROM classes WHERE id = $1 FOR UPDATE', [classId]);
      if (clsRow.rows.length === 0) return { status: 404, msg: 'Class not found.' };
      const enrollCount = await db.query(
        'SELECT COUNT(*)::int AS enrolled FROM class_enrollments WHERE class_id = $1',
        [classId]
      );
      if (enrollCount.rows[0].enrolled >= clsRow.rows[0].capacity) {
        return { status: 409, msg: 'Class is fully booked.' };
      }
      await db.query(
        `INSERT INTO class_enrollments (gym_id, class_id, member_id)
         VALUES (current_gym_id(), $1, $2)`,
        [classId, memberId]
      );
      return { status: 200 };
    });
    if (result.status !== 200) {
      return res.status(result.status).json({ success: false, message: result.msg });
    }
    res.json({ success: true, message: 'Enrolled successfully.' });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ success: false, message: 'Already enrolled in this class.' });
    }
    console.error('[Classes] Enroll error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE unenroll
router.delete('/:id/enroll/:memberId', async (req, res) => {
  const classId = parseInt(req.params.id);
  const memberId = parseInt(req.params.memberId);
  if (!Number.isInteger(classId) || classId <= 0 || !Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid id.' });
  }
  try {
    const count = await withGym(req.gymId, async (db) => {
      const r = await db.query(
        'DELETE FROM class_enrollments WHERE class_id = $1 AND member_id = $2',
        [classId, memberId]
      );
      return r.rowCount;
    });
    if (count === 0) return res.status(404).json({ success: false, message: 'Enrollment not found.' });
    res.json({ success: true, message: 'Unenrolled successfully.' });
  } catch (err) {
    console.error('[Classes] Unenroll error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE class — admin only
router.delete('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid id.' });
  }
  try {
    const count = await withGym(req.gymId, async (db) => {
      const r = await db.query('DELETE FROM classes WHERE id = $1 RETURNING id', [id]);
      return r.rowCount;
    });
    if (count === 0) return res.status(404).json({ success: false, message: 'Class not found.' });
    res.json({ success: true, message: 'Class deleted.' });
  } catch (err) {
    console.error('[Classes] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
