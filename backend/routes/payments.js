const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { query, withGym } = require('../db/db');
const { authenticate, authorize, requireGym } = require('../middleware/auth');

// Webhook is public (signed) — registered BEFORE the auth middleware below.
// Note: payme/click webhooks need to know which gym the transaction belongs to.
// We resolve this from `payments.transaction_ref` after auth via signature.
router.post('/webhook', async (req, res) => {
  const { transactionId, amount, status, gateway, signature } = req.body;
  if (!transactionId || !status || !gateway || !signature) {
    return res.status(400).json({ success: false, message: 'Invalid webhook payload.' });
  }
  const supportedGateways = ['payme', 'click'];
  if (!supportedGateways.includes(gateway)) {
    return res.status(400).json({ success: false, message: 'Invalid gateway.' });
  }
  const expectedSecret = gateway === 'payme' ? process.env.PAYME_SECRET_KEY : process.env.CLICK_SECRET_KEY;
  if (!expectedSecret) {
    return res.status(403).json({ success: false, message: 'Invalid signature.' });
  }
  const signaturePayload = `${transactionId}|${amount}|${status}|${gateway}`;
  const computed = crypto.createHmac('sha256', expectedSecret).update(signaturePayload).digest('hex');
  if (signature !== computed) {
    console.error(`[Payments] Invalid ${gateway} webhook signature`);
    return res.status(403).json({ success: false, message: 'Invalid signature.' });
  }

  try {
    // Find the payment globally to determine the gym (RLS bypassed via plain pool query —
    // but we still use a transaction-level update). For Payme/Click we trust the signature.
    const lookup = await query(
      `SELECT id, gym_id, status FROM payments
       WHERE transaction_ref = $1 AND gateway = $2 LIMIT 1`,
      [transactionId, gateway]
    );
    if (lookup.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Payment not found.' });
    }
    const { gym_id, status: currentStatus } = lookup.rows[0];

    if (status === 'success') {
      if (currentStatus === 'completed') {
        return res.json({ success: true, message: 'Already processed.' });
      }
      await withGym(gym_id, async (db) => {
        await db.query(
          `UPDATE payments SET status = 'completed', processed_at = NOW()
           WHERE transaction_ref = $1 AND gateway = $2`,
          [transactionId, gateway]
        );
      });
      console.log(`[Payments] gym=${gym_id} ${gateway}/${transactionId} money received — awaiting manager approval`);
    } else if (status === 'failed') {
      await withGym(gym_id, async (db) => {
        await db.query(
          `UPDATE payments SET status = 'failed', processed_at = NOW() WHERE transaction_ref = $1`,
          [transactionId]
        );
      });
    }
    res.json({ success: true, message: 'Webhook processed.' });
  } catch (err) {
    console.error('[Payments] Webhook error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Everything below requires staff JWT + tenant context
router.use(authenticate, requireGym);

// GET pending payments
router.get('/pending', authorize('admin', 'super_admin'), async (req, res) => {
  try {
    const data = await withGym(req.gymId, async (db) => {
      const r = await db.query(`
        SELECT p.id, p.amount, p.gateway, p.status, p.receipt_url, p.created_at,
          p.subscription_id,
          m.id AS member_id, m.first_name, m.last_name, m.phone, m.telegram_id,
          s.plan_name, s.total_days
        FROM payments p
        JOIN members m ON m.id = p.member_id
        JOIN subscriptions s ON s.id = p.subscription_id
        WHERE p.status = 'pending'
        ORDER BY p.created_at DESC`);
      return r.rows;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Payments] Pending list error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST approve a pending payment — admin only
router.post('/:id/approve', authorize('admin', 'super_admin'), async (req, res) => {
  const paymentId = parseInt(req.params.id);
  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payment id.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const payment = await db.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (!payment.rows.length) return { status: 404, msg: 'Payment not found' };
      if (payment.rows[0].status !== 'pending') return { status: 409, msg: 'Already processed' };

      const subId = payment.rows[0].subscription_id;
      await db.query(
        `UPDATE subscriptions SET status = 'active', activated_at = NOW(),
         expires_at = GREATEST(expires_at, NOW()) + (COALESCE(calendar_duration_months, 1) * INTERVAL '1 month')
         WHERE id = $1`,
        [subId]
      );
      await db.query(`UPDATE payments SET status = 'completed', processed_at = NOW() WHERE id = $1`, [paymentId]);

      const sub = await db.query('SELECT plan_id, member_id, total_days FROM subscriptions WHERE id = $1', [subId]);
      if (sub.rows.length) {
        await db.query('UPDATE members SET plan_id = $1 WHERE id = $2', [sub.rows[0].plan_id, sub.rows[0].member_id]);
      }
      return { status: 200, memberId: sub.rows[0]?.member_id, totalDays: sub.rows[0]?.total_days };
    });
    if (out.status !== 200) return res.status(out.status).json({ success: false, message: out.msg });

    // Notify member via that gym's bot — fire and forget
    notifyMemberPayment(req.gymId, out.memberId, 'approved', out.totalDays).catch(() => {});
    res.json({ success: true, message: 'Payment approved' });
  } catch (err) {
    console.error('[Payments] Approve error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST reject a pending payment — admin only
router.post('/:id/reject', authorize('admin', 'super_admin'), async (req, res) => {
  const paymentId = parseInt(req.params.id);
  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return res.status(400).json({ success: false, message: 'Invalid payment id.' });
  }
  try {
    const out = await withGym(req.gymId, async (db) => {
      const payment = await db.query('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [paymentId]);
      if (!payment.rows.length) return { status: 404, msg: 'Payment not found' };
      if (payment.rows[0].status !== 'pending') return { status: 409, msg: 'Already processed' };
      await db.query(`UPDATE subscriptions SET status = 'cancelled' WHERE id = $1`, [payment.rows[0].subscription_id]);
      await db.query(`UPDATE payments SET status = 'failed', processed_at = NOW() WHERE id = $1`, [paymentId]);
      return { status: 200, memberId: payment.rows[0].member_id };
    });
    if (out.status !== 200) return res.status(out.status).json({ success: false, message: out.msg });
    notifyMemberPayment(req.gymId, out.memberId, 'rejected').catch(() => {});
    res.json({ success: true, message: 'Payment rejected' });
  } catch (err) {
    console.error('[Payments] Reject error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// GET payment list with optional filters
router.get('/', async (req, res) => {
  const { memberId, status } = req.query;
  try {
    const data = await withGym(req.gymId, async (db) => {
      let sql = `
        SELECT p.id, p.amount, p.gateway, p.status, p.transaction_ref, p.created_at, p.processed_at,
          m.first_name, m.last_name
        FROM payments p
        JOIN members m ON m.id = p.member_id`;
      const params = [];
      const conditions = [];
      if (memberId) { params.push(parseInt(memberId)); conditions.push(`p.member_id = $${params.length}`); }
      if (status)   { params.push(status); conditions.push(`p.status = $${params.length}`); }
      if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
      sql += ' ORDER BY p.created_at DESC LIMIT 100';
      const r = await db.query(sql, params);
      return r.rows;
    });
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Payments] List error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// POST cash payment — admin only
router.post('/cash', authorize('admin', 'super_admin'), async (req, res) => {
  const { memberId, subscriptionId, amount } = req.body;
  if (!memberId || !amount) {
    return res.status(400).json({ success: false, message: 'memberId and amount are required.' });
  }
  try {
    const data = await withGym(req.gymId, async (db) => {
      const payResult = await db.query(
        `INSERT INTO payments (gym_id, member_id, subscription_id, amount, gateway, status, processed_at)
         VALUES (current_gym_id(), $1, $2, $3, 'cash', 'completed', NOW())
         RETURNING id, amount, gateway, status, created_at`,
        [memberId, subscriptionId || null, amount]
      );
      if (subscriptionId) {
        await db.query(
          `UPDATE subscriptions SET status = 'active', activated_at = NOW(),
           expires_at = NOW() + (COALESCE(calendar_duration_months, 1) * INTERVAL '1 month')
           WHERE id = $1 AND status = 'pending'`,
          [subscriptionId]
        );
        const sub = await db.query('SELECT plan_id FROM subscriptions WHERE id = $1', [subscriptionId]);
        if (sub.rows.length > 0 && sub.rows[0].plan_id) {
          await db.query('UPDATE members SET plan_id = $1 WHERE id = $2', [sub.rows[0].plan_id, memberId]);
        }
      }
      return payResult.rows[0];
    });
    res.status(201).json({ success: true, data });
  } catch (err) {
    console.error('[Payments] Cash error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

// Helper: send a Telegram notification to a member via that gym's bot.
// Looks up the member's preferred language from settings, then asks the bot
// manager to send the message. No-op if bot manager isn't loaded.
async function notifyMemberPayment(gymId, memberId, kind, totalDays) {
  if (!memberId) return;
  let info;
  try {
    info = await withGym(gymId, async (db) => {
      const m = await db.query('SELECT telegram_id, first_name FROM members WHERE id = $1', [memberId]);
      if (m.rows.length === 0 || !m.rows[0].telegram_id) return null;
      const langRow = await db.query('SELECT value FROM settings WHERE key = $1', ['lang_' + m.rows[0].telegram_id]);
      return {
        telegramId: m.rows[0].telegram_id,
        firstName: m.rows[0].first_name,
        memberLang: langRow.rows.length > 0 ? langRow.rows[0].value : 'uz',
      };
    });
  } catch { return; }
  if (!info) return;

  try {
    const lang = require('../lib/lang');
    const s = lang[info.memberLang] || lang.uz;
    const text = kind === 'approved' ? s.memberApproved(info.firstName, totalDays) : s.memberRejected;
    const { sendMessage } = require('../bot');
    await sendMessage(gymId, info.telegramId, text, { parse_mode: 'HTML' });
  } catch {}
}

module.exports = router;
