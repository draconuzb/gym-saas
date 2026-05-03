const express = require('express');
const router = express.Router();
const { query } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET all active plans — requires authentication
// Bot uses direct DB queries, not this API route
router.get('/', authenticate, async (req, res) => {
  try {
    const includeInactive = req.query.all === 'true';
    const sql = includeInactive
      ? 'SELECT * FROM plans ORDER BY sort_order ASC'
      : 'SELECT * FROM plans WHERE is_active = true ORDER BY sort_order ASC';
    const result = await query(sql);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Plans] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET single plan
router.get('/:id', authenticate, async (req, res) => {
  try {
    const result = await query('SELECT * FROM plans WHERE id = $1', [parseInt(req.params.id)]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Plans] Get error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST create a new plan — admin only
router.post('/', authenticate, authorize('admin'), async (req, res) => {
  const {
    name, emoji, price, days, description,
    visitQuota, calendarDurationMonths, allowMultiEntryPerDay,
  } = req.body;
  if (!name) {
    return res.status(400).json({ success: false, message: 'name is required.' });
  }
  if (price !== undefined && price < 0) {
    return res.status(400).json({ success: false, message: 'price must be >= 0.' });
  }
  if (days !== undefined && (days < 1 || days > 365)) {
    return res.status(400).json({ success: false, message: 'days must be between 1 and 365.' });
  }

  // visitQuota: null = unlimited, positive int otherwise
  // M3 fix: validate parsed integers are not NaN
  const vq = visitQuota === null ? null : (visitQuota !== undefined ? parseInt(visitQuota) : (days || 12));
  const cdm = calendarDurationMonths !== undefined ? parseInt(calendarDurationMonths) : 1;
  const amed = allowMultiEntryPerDay === true;

  if (vq !== null && isNaN(vq)) {
    return res.status(400).json({ success: false, message: 'visitQuota must be a number or null.' });
  }
  if (isNaN(cdm)) {
    return res.status(400).json({ success: false, message: 'calendarDurationMonths must be a number.' });
  }

  try {
    const result = await query(
      `INSERT INTO plans (name, emoji, price, days, description, visit_quota, calendar_duration_months, allow_multi_entry_per_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, emoji || '📦', price || 0, days || 12, description || '', vq, cdm, amed]
    );
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Plans] Create error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// PUT update a plan — admin only
router.put('/:id', authenticate, authorize('admin'), async (req, res) => {
  const {
    name, emoji, price, days, description, isActive,
    visitQuota, calendarDurationMonths, allowMultiEntryPerDay,
  } = req.body;
  const planId = parseInt(req.params.id);

  if (price !== undefined && price < 0) {
    return res.status(400).json({ success: false, message: 'price must be >= 0.' });
  }
  if (days !== undefined && (days < 1 || days > 365)) {
    return res.status(400).json({ success: false, message: 'days must be between 1 and 365.' });
  }

  try {
    const existing = await query('SELECT * FROM plans WHERE id = $1', [planId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }

    const p = existing.rows[0];
    // visitQuota can be explicitly null for "unlimited"
    const vq = (visitQuota === null) ? null
             : (visitQuota !== undefined ? parseInt(visitQuota) : p.visit_quota);
    const cdm = calendarDurationMonths !== undefined ? parseInt(calendarDurationMonths) : p.calendar_duration_months;
    const amed = allowMultiEntryPerDay !== undefined ? (allowMultiEntryPerDay === true) : p.allow_multi_entry_per_day;

    // M3 fix: validate parsed integers
    if (vq !== null && isNaN(vq)) {
      return res.status(400).json({ success: false, message: 'visitQuota must be a number or null.' });
    }
    if (isNaN(cdm)) {
      return res.status(400).json({ success: false, message: 'calendarDurationMonths must be a number.' });
    }

    const result = await query(
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

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('[Plans] Update error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// DELETE a plan — admin only, blocks if active subscriptions exist
router.delete('/:id', authenticate, authorize('admin'), async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    const activeSubs = await query(
      "SELECT COUNT(*) AS n FROM subscriptions WHERE plan_id = $1 AND status IN ('active', 'pending')",
      [planId]
    );
    if (parseInt(activeSubs.rows[0].n) > 0) {
      return res.status(409).json({ success: false, message: 'Plan has active subscriptions. Deactivate it instead.' });
    }
    const result = await query('DELETE FROM plans WHERE id = $1 RETURNING id', [planId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    res.json({ success: true, message: 'Plan deleted.' });
  } catch (err) {
    console.error('[Plans] Delete error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
