const express = require('express');
const router = express.Router();
const { query, withGym } = require('../db/db');
const { safeCompare } = require('../lib/qr');

/**
 * POST /api/hardware/:gym_slug/turnstile/trigger
 * RFID/NFC turnstile from Raspberry Pi / Arduino.
 * Authenticated via the gym's hardware_secret in body or X-Hardware-Token.
 *
 * Body: { deviceId, rfidTag, token }
 *   token may also be sent as X-Hardware-Token header.
 */
router.post('/:gym_slug/turnstile/trigger', async (req, res) => {
  const { deviceId, rfidTag } = req.body;
  const token = req.body?.token || req.headers['x-hardware-token'];
  const slug = req.params.gym_slug;

  if (!deviceId || !token) {
    return res.status(400).json({ success: false, action: 'DENY', message: 'Missing deviceId or token.' });
  }

  // Resolve gym + verify hardware token
  const gymRes = await query(
    'SELECT id, hardware_secret FROM gyms WHERE slug = $1 AND is_active = true',
    [slug]
  );
  if (gymRes.rows.length === 0) {
    return res.status(404).json({ success: false, action: 'DENY', message: 'Gym not found.' });
  }
  const gym = gymRes.rows[0];
  if (!safeCompare(token, gym.hardware_secret)) {
    return res.status(403).json({ success: false, action: 'DENY', message: 'Unauthorized hardware.' });
  }
  if (!rfidTag) {
    return res.status(400).json({ success: false, action: 'DENY', message: 'No RFID tag provided.' });
  }

  try {
    const result = await withGym(gym.id, async (db) => {
      // RFID is matched against telegram_id (placeholder until rfid_tag column added)
      const member = await db.query(
        'SELECT id, first_name FROM members WHERE telegram_id = $1 AND is_active = true',
        [rfidTag]
      );
      if (member.rows.length === 0) {
        console.log(`[Hardware ${slug}] ${deviceId}: unknown tag ${rfidTag}`);
        return { action: 'LOCK', color: 'RED_LED', reason: 'unknown_tag' };
      }
      const memberId = member.rows[0].id;

      const sub = await db.query(
        `SELECT id, total_days, days_used, visit_quota, allow_multi_entry_per_day, expires_at
         FROM subscriptions
         WHERE member_id = $1 AND status = 'active'
           AND (visit_quota IS NULL OR (total_days - days_used) > 0)
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [memberId]
      );
      if (sub.rows.length === 0) {
        console.log(`[Hardware ${slug}] ${deviceId}: expired sub for ${member.rows[0].first_name}`);
        return { action: 'LOCK', color: 'RED_LED', reason: 'no_active_sub' };
      }
      const subRow = sub.rows[0];

      if (subRow.expires_at && new Date(subRow.expires_at) < new Date()) {
        console.log(`[Hardware ${slug}] ${deviceId}: calendar expired for ${member.rows[0].first_name}`);
        return { action: 'LOCK', color: 'RED_LED', reason: 'calendar_expired' };
      }

      let shouldDeduct = subRow.visit_quota !== null;
      if (shouldDeduct && subRow.allow_multi_entry_per_day) {
        const todayCheck = await db.query(
          `SELECT id FROM checkins WHERE member_id = $1 AND checked_in_at::date = CURRENT_DATE`,
          [memberId]
        );
        if (todayCheck.rows.length > 0) shouldDeduct = false;
      }
      if (shouldDeduct) {
        await db.query('UPDATE subscriptions SET days_used = days_used + 1 WHERE id = $1', [subRow.id]);
      }
      await db.query(
        `INSERT INTO checkins (gym_id, member_id, subscription_id, approved_by_staff)
         VALUES (current_gym_id(), $1, $2, true)`,
        [memberId, subRow.id]
      );
      console.log(`[Hardware ${slug}] ${deviceId}: UNLOCK for ${member.rows[0].first_name}`);
      return { action: 'UNLOCK', color: 'GREEN_LED' };
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Hardware] Turnstile error:', err.message);
    res.status(500).json({ success: false, action: 'DENY', message: 'Server error.' });
  }
});

module.exports = router;
