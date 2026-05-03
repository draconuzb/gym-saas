const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { query, getClient } = require('../db/db');

/**
 * POST /api/hardware/turnstile/trigger
 * Handle RFID/NFC scan from Raspberry Pi / Arduino turnstile
 * Authenticated via HARDWARE_AUTH_SECRET
 */
router.post('/turnstile/trigger', async (req, res) => {
  const { deviceId, rfidTag, token } = req.body;

  if (!deviceId || !token) {
    return res.status(400).json({ success: false, action: 'DENY', message: 'Missing deviceId or token.' });
  }

  const expectedToken = process.env.HARDWARE_AUTH_SECRET || '';
  if (!expectedToken || !token) {
    return res.status(403).json({ success: false, action: 'DENY', message: 'Unauthorized hardware.' });
  }
  try {
    const a = Buffer.from(String(token), 'utf8');
    const b = Buffer.from(expectedToken, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      throw new Error('mismatch');
    }
  } catch {
    return res.status(403).json({ success: false, action: 'DENY', message: 'Unauthorized hardware.' });
  }

  if (!rfidTag) {
    return res.status(400).json({ success: false, action: 'DENY', message: 'No RFID tag provided.' });
  }

  const client = await getClient();
  try {
    // Look up member by RFID tag (future: add rfid_tag column to members)
    // For now, check by telegram_id as a stand-in
    const member = await client.query(
      'SELECT id, first_name FROM members WHERE telegram_id = $1 AND is_active = true',
      [rfidTag]
    );

    if (member.rows.length === 0) {
      console.log(`[Hardware] ${deviceId}: unknown tag ${rfidTag}`);
      // M2 fix: client.release is now only in the finally block
      return res.json({ success: true, action: 'LOCK', color: 'RED_LED' });
    }

    const memberId = member.rows[0].id;

    await client.query('BEGIN');

    // Check active subscription with row lock (include dynamic tariff fields)
    const sub = await client.query(
      `SELECT id, total_days, days_used, visit_quota, allow_multi_entry_per_day, expires_at
       FROM subscriptions
       WHERE member_id = $1 AND status = 'active' AND (visit_quota IS NULL OR (total_days - days_used) > 0)
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [memberId]
    );

    if (sub.rows.length === 0) {
      await client.query('COMMIT');
      console.log(`[Hardware] ${deviceId}: expired sub for ${member.rows[0].first_name}`);
      return res.json({ success: true, action: 'LOCK', color: 'RED_LED' });
    }

    const subRow = sub.rows[0];

    // Calendar hard expiry check
    if (subRow.expires_at && new Date(subRow.expires_at) < new Date()) {
      await client.query('COMMIT');
      console.log(`[Hardware] ${deviceId}: calendar expired for ${member.rows[0].first_name}`);
      return res.json({ success: true, action: 'LOCK', color: 'RED_LED' });
    }

    // Deduction logic — aligned with QR attendance system
    let shouldDeduct = subRow.visit_quota !== null;
    if (shouldDeduct && subRow.allow_multi_entry_per_day) {
      const todayCheck = await client.query(
        `SELECT id FROM checkins WHERE member_id = $1 AND checked_in_at::date = CURRENT_DATE`,
        [memberId]
      );
      if (todayCheck.rows.length > 0) shouldDeduct = false;
    }

    if (shouldDeduct) {
      await client.query('UPDATE subscriptions SET days_used = days_used + 1 WHERE id = $1', [subRow.id]);
    }
    await client.query(
      'INSERT INTO checkins (member_id, subscription_id, approved_by_staff) VALUES ($1, $2, true)',
      [memberId, subRow.id]
    );

    await client.query('COMMIT');

    console.log(`[Hardware] ${deviceId}: UNLOCK for ${member.rows[0].first_name}`);
    res.json({ success: true, action: 'UNLOCK', color: 'GREEN_LED' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Hardware] Turnstile error:', err.message);
    res.status(500).json({ success: false, action: 'DENY', message: 'Server error.' });
  } finally {
    client.release();
  }
});

module.exports = router;
