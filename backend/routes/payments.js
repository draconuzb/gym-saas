const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { query, getClient } = require('../db/db');
const { authenticate, authorize } = require('../middleware/auth');

// GET pending payments for approval dashboard
router.get('/pending', authenticate, authorize('admin'), async (req, res) => {
  try {
    const result = await query(`
      SELECT p.id, p.amount, p.gateway, p.status, p.receipt_url, p.created_at,
        p.subscription_id,
        m.id AS member_id, m.first_name, m.last_name, m.phone, m.telegram_id,
        s.plan_name, s.total_days
      FROM payments p
      JOIN members m ON m.id = p.member_id
      JOIN subscriptions s ON s.id = p.subscription_id
      WHERE p.status = 'pending'
      ORDER BY p.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Payments] Pending list error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST approve a pending payment
router.post('/:id/approve', authenticate, authorize('admin'), async (req, res) => {
  const paymentId = parseInt(req.params.id);
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Lock the payment row to prevent concurrent approval
    const payment = await client.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
    if (!payment.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Payment not found' });
    }
    if (payment.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, message: 'Already processed' });
    }

    const subId = payment.rows[0].subscription_id;

    // Activate subscription — use GREATEST(expires_at, NOW()) to not lose remaining days
    await client.query(
      `UPDATE subscriptions SET status = 'active', activated_at = NOW(),
       expires_at = GREATEST(expires_at, NOW()) + (COALESCE(calendar_duration_months, 1) * INTERVAL '1 month')
       WHERE id = $1`,
      [subId]
    );
    await client.query(`UPDATE payments SET status = 'completed', processed_at = NOW() WHERE id = $1`, [paymentId]);

    // Update member plan
    const sub = await client.query('SELECT plan_id, member_id, total_days FROM subscriptions WHERE id = $1', [subId]);
    if (sub.rows.length) {
      await client.query('UPDATE members SET plan_id = $1 WHERE id = $2', [sub.rows[0].plan_id, sub.rows[0].member_id]);
    }

    await client.query('COMMIT');

    // Notify member via bot (if bot is available) — outside transaction
    try {
      const member = await query('SELECT telegram_id, first_name FROM members WHERE id = $1', [sub.rows[0].member_id]);
      if (member.rows.length && member.rows[0].telegram_id) {
        const lang = require('../lib/lang');
        const langResult = await query('SELECT value FROM settings WHERE key = $1', ['lang_' + member.rows[0].telegram_id]);
        const memberLang = langResult.rows.length > 0 ? langResult.rows[0].value : 'uz';
        const s = lang[memberLang] || lang.uz;
        const bot = require('../bot');
        bot.telegram.sendMessage(member.rows[0].telegram_id,
          s.memberApproved(member.rows[0].first_name, sub.rows[0].total_days),
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    } catch {}

    res.json({ success: true, message: 'Payment approved' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Payments] Approve error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

// POST reject a pending payment
router.post('/:id/reject', authenticate, authorize('admin'), async (req, res) => {
  try {
    const paymentId = parseInt(req.params.id);

    const payment = await query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    if (!payment.rows.length) return res.status(404).json({ success: false, message: 'Payment not found' });
    if (payment.rows[0].status !== 'pending') return res.status(409).json({ success: false, message: 'Already processed' });

    await query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [payment.rows[0].subscription_id]);
    await query(`UPDATE payments SET status = 'failed', processed_at = NOW() WHERE id = $1`, [paymentId]);

    // Notify member
    try {
      const member = await query('SELECT telegram_id FROM members WHERE id = $1', [payment.rows[0].member_id]);
      if (member.rows.length && member.rows[0].telegram_id) {
        const lang = require('../lib/lang');
        const langResult = await query('SELECT value FROM settings WHERE key = $1', ['lang_' + member.rows[0].telegram_id]);
        const memberLang = langResult.rows.length > 0 ? langResult.rows[0].value : 'uz';
        const s = lang[memberLang] || lang.uz;
        const bot = require('../bot');
        bot.telegram.sendMessage(member.rows[0].telegram_id,
          s.memberRejected,
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    } catch {}

    res.json({ success: true, message: 'Payment rejected' });
  } catch (err) {
    console.error('[Payments] Reject error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET all payment transactions
router.get('/', authenticate, async (req, res) => {
  try {
    const { memberId, status } = req.query;
    let sql = `
      SELECT p.id, p.amount, p.gateway, p.status, p.transaction_ref, p.created_at, p.processed_at,
        m.first_name, m.last_name
      FROM payments p
      JOIN members m ON m.id = p.member_id
    `;
    const params = [];
    const conditions = [];

    if (memberId) {
      params.push(parseInt(memberId));
      conditions.push(`p.member_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`p.status = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY p.created_at DESC LIMIT 100';

    const result = await query(sql, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[Payments] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST record a cash payment (admin manually confirms)
// Activates the subscription and updates member's current plan in one transaction
router.post('/cash', authenticate, authorize('admin'), async (req, res) => {
  const { memberId, subscriptionId, amount } = req.body;

  if (!memberId || !amount) {
    return res.status(400).json({ success: false, message: 'memberId and amount are required.' });
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Create the completed cash payment
    const payResult = await client.query(
      `INSERT INTO payments (member_id, subscription_id, amount, gateway, status, processed_at)
       VALUES ($1, $2, $3, 'cash', 'completed', NOW())
       RETURNING id, amount, gateway, status, created_at`,
      [memberId, subscriptionId || null, amount]
    );

    // If a subscription is linked, activate it and update member's plan
    if (subscriptionId) {
      await client.query(
        `UPDATE subscriptions SET status = 'active', activated_at = NOW(),
         expires_at = NOW() + (COALESCE(calendar_duration_months, 1) * INTERVAL '1 month')
         WHERE id = $1 AND status = 'pending'`,
        [subscriptionId]
      );

      const sub = await client.query('SELECT plan_id FROM subscriptions WHERE id = $1', [subscriptionId]);
      if (sub.rows.length > 0 && sub.rows[0].plan_id) {
        await client.query('UPDATE members SET plan_id = $1 WHERE id = $2', [sub.rows[0].plan_id, memberId]);
      }
    }

    await client.query('COMMIT');
    res.status(201).json({ success: true, data: payResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Payments] Cash error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  } finally {
    client.release();
  }
});

/**
 * POST /api/payments/webhook
 * Handle Payme/Click webhook callbacks
 * Secured by checking gateway-specific signatures
 */
router.post('/webhook', async (req, res) => {
  const { transactionId, amount, status, gateway, signature } = req.body;

  if (!transactionId || !status || !gateway || !signature) {
    return res.status(400).json({ success: false, message: 'Invalid webhook payload.' });
  }

  // Generic check — don't reveal which gateways are configured
  const supportedGateways = ['payme', 'click'];
  if (!supportedGateways.includes(gateway)) {
    return res.status(400).json({ success: false, message: 'Invalid gateway.' });
  }

  const expectedSecret = gateway === 'payme'
    ? process.env.PAYME_SECRET_KEY
    : process.env.CLICK_SECRET_KEY;

  if (!expectedSecret) {
    return res.status(403).json({ success: false, message: 'Invalid signature.' });
  }

  // HMAC signature verification (use explicit field order to avoid JSON key-order mismatch)
  const signaturePayload = `${transactionId}|${amount}|${status}|${gateway}`;
  const computedSignature = crypto
    .createHmac('sha256', expectedSecret)
    .update(signaturePayload)
    .digest('hex');

  if (signature !== computedSignature) {
    console.error(`[Payments] Invalid ${gateway} webhook signature`);
    return res.status(403).json({ success: false, message: 'Invalid signature.' });
  }

  try {
    // Replay protection — skip if already processed
    if (status === 'success') {
      const alreadyProcessed = await query(
        'SELECT id FROM payments WHERE transaction_ref = $1 AND status = $2',
        [transactionId, 'completed']
      );
      if (alreadyProcessed.rows.length > 0) {
        return res.json({ success: true, message: 'Already processed.' });
      }
    }

    if (status === 'success') {
      // Mark payment as completed (money received), but KEEP subscription as pending.
      // Manager must manually approve the subscription from the web dashboard.
      await query(
        `UPDATE payments SET status = 'completed', processed_at = NOW()
         WHERE transaction_ref = $1 AND gateway = $2`,
        [transactionId, gateway]
      );

      console.log(`[Payments] ${gateway} payment ${transactionId} money received — awaiting manager approval`);
    } else if (status === 'failed') {
      await query(
        `UPDATE payments SET status = 'failed', processed_at = NOW()
         WHERE transaction_ref = $1`, [transactionId]
      );
    }

    res.json({ success: true, message: 'Webhook processed.' });
  } catch (err) {
    console.error('[Payments] Webhook error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

module.exports = router;
