const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('[Auth] FATAL: JWT_SECRET is not set in production!');
    process.exit(1);
  }
  console.warn('[Auth] WARNING: JWT_SECRET not set — using insecure dev secret');
}

const secret = JWT_SECRET || 'dev_insecure_secret_DO_NOT_USE_IN_PROD';

/**
 * Middleware: Verify JWT token from Authorization header
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded; // { id, role }

    // Verify the user still exists in the DB (handles deleted/blocked staff)
    try {
      const { query } = require('../db/db');
      const userCheck = await query('SELECT id FROM users WHERE id = $1', [decoded.id]);
      if (userCheck.rows.length === 0) {
        return res.status(401).json({ success: false, message: 'User account no longer exists.' });
      }
    } catch (dbErr) {
      console.error('[Auth] DB user check failed:', dbErr.message);
      return res.status(503).json({ success: false, message: 'Service temporarily unavailable.' });
    }

    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
};

/**
 * Middleware: Restrict access to specific roles
 * @param {...string} roles - allowed roles e.g. 'admin', 'receptionist'
 */
const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({
      success: false,
      message: `Role '${req.user?.role}' is not authorized for this resource.`,
    });
  }
  next();
};

/**
 * Sign a short-lived access token (1 hour)
 */
const signToken = (payload, expiresIn = '1h') => {
  return jwt.sign(payload, secret, { expiresIn });
};

/**
 * Sign a long-lived refresh token (7 days)
 */
const signRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET || secret + '_refresh', { expiresIn: '7d' });
};

/**
 * Verify a refresh token
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET || secret + '_refresh');
};

/**
 * Verify a JWT token (used by endpoints that need manual verification)
 */
const verifyToken = (token) => {
  return jwt.verify(token, secret);
};

module.exports = { authenticate, authorize, signToken, signRefreshToken, verifyRefreshToken, verifyToken };
