const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query, withGym } = require('../db/db');
const { signToken, signRefreshToken, verifyRefreshToken, authenticate } = require('../middleware/auth');
const { clientIp, rateLimiter, accountLockout, redact, validatePassword } = require('../lib/security');

// Two layers of brute-force protection:
//   1. Per-IP rate limit — blocks scripted scanning from a single source
//   2. Per-account lockout — blocks distributed attacks against ONE phone
//      (a botnet could rotate IPs but the target identity is fixed)
const loginIpLimit = rateLimiter({
  keyFn: clientIp,
  max: 10, windowMs: 15 * 60 * 1000,
  message: 'Too many login attempts from this address. Try again in 15 minutes.',
  name: 'login-ip',
});

const loginLockout = accountLockout({
  max: 5, windowMs: 15 * 60 * 1000, lockMs: 15 * 60 * 1000,
});

/**
 * POST /api/auth/login
 * Body: { phone, password, gym_slug? }
 * - super_admin (gym_id IS NULL) logs in by phone+password alone
 * - tenant users (admin/receptionist) need gym_slug to disambiguate when
 *   the same phone is registered in multiple gyms
 */
router.post('/login', loginIpLimit, async (req, res) => {
  const { phone, password, gym_slug } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Phone and password are required.' });
  }

  // Account-level lockout — keyed on (gym_slug, phone) so each gym's
  // admin and the platform super-admin lock independently.
  const lockKey = `${gym_slug || '__super__'}|${phone}`;
  const lock = loginLockout.guard(lockKey);
  if (lock.locked) {
    res.set('Retry-After', String(lock.retryAfter));
    return res.status(429).json({
      success: false,
      message: `Hisob vaqtinchalik bloklangan. ${Math.ceil(lock.retryAfter / 60)} daqiqadan keyin urinib ko'ring.`,
    });
  }

  try {
    let user;
    if (gym_slug) {
      // Two-step lookup: resolve gym first (no RLS on gyms), then query users
      // with tenant context set so RLS lets the row through.
      const gymRes = await query(
        `SELECT id, name FROM gyms WHERE slug = $1 AND is_active = true`,
        [gym_slug]
      );
      if (gymRes.rows.length === 0) {
        loginLockout.fail(lockKey);
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }
      const gym = gymRes.rows[0];
      const userRes = await withGym(gym.id, async (db) =>
        db.query(
          `SELECT id, phone, role, password_hash, first_name, gym_id
           FROM users WHERE phone = $1 AND gym_id IS NOT NULL`,
          [phone]
        )
      );
      if (userRes.rows.length === 0) {
        loginLockout.fail(lockKey);
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }
      user = { ...userRes.rows[0], gym_slug, gym_name: gym.name };
    } else {
      const result = await query(
        `SELECT id, phone, role, password_hash, first_name, gym_id
         FROM users
         WHERE phone = $1 AND gym_id IS NULL AND role = 'super_admin'`,
        [phone]
      );
      if (result.rows.length === 0) {
        loginLockout.fail(lockKey);
        return res.status(401).json({ success: false, message: 'Invalid credentials.' });
      }
      user = result.rows[0];
    }
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      loginLockout.fail(lockKey);
      console.warn(`[Auth] failed login phone=${redact(phone)} gym=${gym_slug || '__super__'}`);
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // Successful auth — clear any prior failed attempts for this account
    loginLockout.clear(lockKey);
    const payload = { id: user.id, role: user.role, gym_id: user.gym_id };
    const token = signToken(payload);
    const refreshToken = signRefreshToken(payload);

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000,
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      token,
      refreshToken,
      user: {
        id: user.id,
        role: user.role,
        firstName: user.first_name,
        gymId: user.gym_id,
        gymSlug: user.gym_slug || null,
        gymName: user.gym_name || null,
      },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * GET /api/auth/gyms-by-phone?phone=+998...
 * Helper for the login UI: when a phone is registered in multiple gyms,
 * the user picks which one to sign into. Returns ONLY public gym info,
 * never reveals whether the password is correct.
 */
router.get('/gyms-by-phone', async (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.json({ success: true, gyms: [], has_super_admin: false });

  try {
    // users is RLS-protected; iterate gyms and check each one inside its own
    // tenant context. N+1 — acceptable since this endpoint is only hit at
    // login time and gym counts stay small.
    const gymsRes = await query(
      `SELECT id, slug, name FROM gyms WHERE is_active = true ORDER BY name`
    );
    const matched = [];
    for (const gym of gymsRes.rows) {
      const userRes = await withGym(gym.id, async (db) =>
        db.query('SELECT 1 FROM users WHERE phone = $1 LIMIT 1', [phone])
      ).catch(() => ({ rows: [] }));
      if (userRes.rows.length > 0) {
        matched.push({ slug: gym.slug, name: gym.name });
      }
    }

    // Also check for a super_admin with this phone (gym_id IS NULL).
    // RLS lets gym_id IS NULL through under any context.
    const superRes = await query(
      `SELECT 1 FROM users WHERE phone = $1 AND gym_id IS NULL AND role = 'super_admin' LIMIT 1`,
      [phone]
    );
    const has_super_admin = superRes.rows.length > 0;

    res.json({ success: true, gyms: matched, has_super_admin });
  } catch (err) {
    console.error('[Auth] gyms-by-phone error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/change-password
 */
router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
  }
  const pwdErr = validatePassword(newPassword);
  if (pwdErr) {
    return res.status(400).json({ success: false, message: pwdErr });
  }

  try {
    const lookup = req.user.gym_id == null
      ? () => query('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id])
      : () => withGym(req.user.gym_id, async (db) =>
          db.query('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]));
    const result = await lookup();
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }
    const newHash = await bcrypt.hash(newPassword, 10);
    if (req.user.gym_id == null) {
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
    } else {
      await withGym(req.user.gym_id, async (db) =>
        db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]));
    }
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('[Auth] Change password error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/refresh
 */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token is required.' });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);
    const result = decoded.gym_id == null
      ? await query('SELECT id, role, gym_id FROM users WHERE id = $1', [decoded.id])
      : await withGym(decoded.gym_id, async (db) =>
          db.query('SELECT id, role, gym_id FROM users WHERE id = $1', [decoded.id])
        );
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }
    const user = result.rows[0];
    const newToken = signToken({ id: user.id, role: user.role, gym_id: user.gym_id });
    res.json({ success: true, token: newToken });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.json({ success: true });
});

module.exports = router;
