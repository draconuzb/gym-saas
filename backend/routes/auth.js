const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { query } = require('../db/db');
const { signToken, signRefreshToken, verifyRefreshToken, authenticate } = require('../middleware/auth');

// Simple rate limiter for login
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10;

// Cleanup stale login entries every 15 minutes
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
    // Clean old entries
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
 * Authenticate staff user (admin, receptionist) and return JWT
 */
router.post('/login', loginRateLimit, async (req, res) => {
  const { phone, password } = req.body;

  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Phone and password are required.' });
  }

  try {
    const result = await query(
      'SELECT id, phone, role, password_hash, first_name FROM users WHERE phone = $1',
      [phone]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = signToken({ id: user.id, role: user.role });
    const refreshToken = signRefreshToken({ id: user.id, role: user.role });

    // Set httpOnly cookies for secure token storage
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 1000 // 1 hour
    });
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth/refresh',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    // Also return tokens in JSON body for backward compatibility
    res.json({
      success: true,
      token,
      refreshToken,
      user: { id: user.id, role: user.role, firstName: user.first_name },
    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/change-password
 * Change password for the authenticated user
 */
router.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current password and new password are required.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
  }

  if (newPassword.length > 128) {
    return res.status(400).json({ success: false, message: 'New password must not exceed 128 characters.' });
  }

  try {
    const result = await query(
      'SELECT id, password_hash FROM users WHERE id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(currentPassword, user.password_hash);

    if (!isValid) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const saltRounds = 10;
    const newHash = await bcrypt.hash(newPassword, saltRounds);

    await query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newHash, req.user.id]
    );

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('[Auth] Change password error:', err.message);
    res.status(500).json({ success: false, message: 'Internal server error.' });
  }
});

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new access token
 */
router.post('/refresh', async (req, res) => {
  const refreshToken = req.cookies?.refreshToken || req.body?.refreshToken;
  if (!refreshToken) {
    return res.status(400).json({ success: false, message: 'Refresh token is required.' });
  }

  try {
    const decoded = verifyRefreshToken(refreshToken);

    // Verify user still exists and is valid
    const result = await query('SELECT id, role FROM users WHERE id = $1', [decoded.id]);
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User not found.' });
    }

    const user = result.rows[0];
    const newToken = signToken({ id: user.id, role: user.role });

    res.json({ success: true, token: newToken });
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired refresh token.' });
  }
});

/**
 * POST /api/auth/logout
 * Clear auth cookies
 */
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.json({ success: true });
});

module.exports = router;
