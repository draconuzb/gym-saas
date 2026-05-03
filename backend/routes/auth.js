const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query } = require('../db/db');
const { signToken, signRefreshToken, verifyRefreshToken, authenticate } = require('../middleware/auth');

const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.firstAttempt > RATE_LIMIT_WINDOW) loginAttempts.delete(ip);
  }
}, RATE_LIMIT_WINDOW);

function loginRateLimit(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  const attempts = loginAttempts.get(ip);

  if (attempts) {
    if (now - attempts.firstAttempt > RATE_LIMIT_WINDOW) {
      loginAttempts.delete(ip);
    } else if (attempts.count >= MAX_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many login attempts. Try again in 15 minutes.' });
    }
  }

  const entry = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  entry.count++;
  loginAttempts.set(ip, entry);
  next();
}

/**
 * POST /api/auth/login
 * Body: { phone, password, gym_slug? }
 * - super_admin (gym_id IS NULL) logs in by phone+password alone
 * - tenant users (admin/receptionist) need gym_slug to disambiguate when
 *   the same phone is registered in multiple gyms
 */
router.post('/login', loginRateLimit, async (req, res) => {
  const { phone, password, gym_slug } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Phone and password are required.' });
  }

  try {
    let result;
    if (gym_slug) {
      result = await query(
        `SELECT u.id, u.phone, u.role, u.password_hash, u.first_name, u.gym_id, g.slug AS gym_slug, g.name AS gym_name
         FROM users u
         JOIN gyms g ON g.id = u.gym_id
         WHERE u.phone = $1 AND g.slug = $2 AND g.is_active = true`,
        [phone, gym_slug]
      );
    } else {
      // No gym_slug provided: only super_admin can log in this way.
      result = await query(
        `SELECT id, phone, role, password_hash, first_name, gym_id
         FROM users
         WHERE phone = $1 AND gym_id IS NULL AND role = 'super_admin'`,
        [phone]
      );
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

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
  if (!phone) return res.json({ success: true, gyms: [] });

  try {
    const result = await query(
      `SELECT g.slug, g.name
       FROM users u
       JOIN gyms g ON g.id = u.gym_id
       WHERE u.phone = $1 AND g.is_active = true
       ORDER BY g.name`,
      [phone]
    );
    res.json({ success: true, gyms: result.rows });
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
  if (newPassword.length < 6 || newPassword.length > 128) {
    return res.status(400).json({ success: false, message: 'New password must be 6-128 characters.' });
  }

  try {
    const result = await query('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isValid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
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
    const result = await query('SELECT id, role, gym_id FROM users WHERE id = $1', [decoded.id]);
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
