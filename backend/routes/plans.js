const express = require('express');
const router = express.Router();
const { withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

router.use(authenticate, requireGym);

// GET all plans (filter by ?all=true to include inactive)
router.get('/', async (req, res) => {
  try {
    const includeInactive = req.query.all === 'true';
    const sql = includeInactive
      ? 'SELECT * FROM plans ORDER BY sort_order ASC'
      : 'SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC';
    const data = await withGym(req.gymId, async (db) => (await db.query(sql)).rows);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Plans] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET single plan
router.get('/:id', async (req, res) => {
  const planId = parseInt(req.params.id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid plan id.' });
  }
  try {
    const row = await withGym(req.gymId, async (db) => {
      const r = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
      return r.rows[0] || null;
    });
    if (!row) return res.status(404).json({ success: false, message: 'Plan not found.' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[Plans] Get error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST create plan — admin only
router.post('/', authorize('admin', 'super_admin'), async (req, res) => {
  const {
    name, emoji, price, days, description,
    visitQuota, calendarDurationMonths, allowMultiEntryPerDay,
  } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'name is required.' });
  if (price !== undefined && price < 0) {
    return res.status(400).json({ success: false, message: 'price must be >= 0.' });
  }
  if (days !== undefined && (days < 1 || days > 365)) {
    return res.status(400).json({ success: false, message: 'days must be between 1 and 365.' });
  }

  const vq = visitQuota === null ? null
           : (visitQuota !== undefined ? parseInt(visitQuota) : (days || 12));
  const cdm = calendarDurationMonths !== undefined ? parseInt(calendarDurationMonths) : 1;
  const amed = allowMultiEntryPerDay === true;
  if (vq !== null && isNaN(vq)) {
    return res.status(400).json({ success: false, message: 'visitQuota must be a number or null.' });
  }
  if (isNaN(cdm)) {
    return res.status(400).json({ success: false, message: 'calendarDurationMonths must be a number.' });
  }

  try {
    const row = await withGym(req.gymId, async (db) => {
      const r = await db.query(
        `INSERT INTO plans
           (gym_id, name, emoji, price, days, description, visit_quota, calendar_duration_months, allow_multi_entry_per_day)
         VALUES (current_gym_id(), $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [name, emoji || '📦', price || 0, days || 12, description || '', vq, cdm, amed]
      );
      return r.rows[0];
    });
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    console.error('[Plans] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT update plan — admin only
router.put('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  const planId = parseInt(req.params.id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid plan id.' });
  }
  const {
    name, emoji, price, days, description, isActive,
    visitQuota, calendarDurationMonths, allowMultiEntryPerDay,
  } = req.body;

  if (price !== undefined && price < 0) {
    return res.status(400).json({ success: false, message: 'price must be >= 0.' });
  }
  if (days !== undefined && (days < 1 || days > 365)) {
    return res.status(400).json({ success: false, message: 'days must be between 1 and 365.' });
  }

  try {
    const row = await withGym(req.gymId, async (db) => {
      const existing = await db.query('SELECT * FROM plans WHERE id = $1', [planId]);
      if (existing.rows.length === 0) return null;
      const p = existing.rows[0];

      const vq = (visitQuota === null) ? null
               : (visitQuota !== undefined ? parseInt(visitQuota) : p.visit_quota);
      const cdm = calendarDurationMonths !== undefined ? parseInt(calendarDurationMonths) : p.calendar_duration_months;
      const amed = allowMultiEntryPerDay !== undefined ? (allowMultiEntryPerDay === true) : p.allow_multi_entry_per_day;

      if (vq !== null && isNaN(vq)) throw new Error('visitQuota must be a number or null');
      if (isNaN(cdm)) throw new Error('calendarDurationMonths must be a number');

      const r = await db.query(
        `UPDATE plans SET
           name = $1, emoji = $2, price = $3, days = $4,
           description = $5, is_active = $6,
           visit_quota = $7, calendar_duration_months = $8, allow_multi_entry_per_day = $9
         WHERE id = $10 RETURNING *`,
        [
          name ?? p.name,
          emoji ?? p.emoji,
          price ?? p.price,
          days ?? p.days,
          description ?? p.description,
          isActive ?? p.is_active,
          vq, cdm, amed,
          planId,
        ]
      );
      return r.rows[0];
    });
    if (!row) return res.status(404).json({ success: false, message: 'Plan not found.' });
    res.json({ success: true, data: row });
  } catch (err) {
    console.error('[Plans] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE plan — admin only, blocked if any active subscription uses it
router.delete('/:id', authorize('admin', 'super_admin'), async (req, res) => {
  const planId = parseInt(req.params.id);
  if (!Number.isInteger(planId) || planId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid plan id.' });
  }
  try {
    const result = await withGym(req.gymId, async (db) => {
      const activeSubs = await db.query(
        "SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = $1 AND status IN ('active', 'pending')",
        [planId]
      );
      if (parseInt(activeSubs.rows[0].n) > 0) {
        return { conflict: true };
      }
      const del = await db.query('DELETE FROM plans WHERE id = $1 RETURNING id', [planId]);
      return { deleted: del.rowCount };
    });
    if (result.conflict) {
      return res.status(409).json({ success: false, message: 'Plan has active subscriptions. Deactivate it instead.' });
    }
    if (result.deleted === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    res.json({ success: true, message: 'Plan deleted.' });
  } catch (err) {
    console.error('[Plans] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
