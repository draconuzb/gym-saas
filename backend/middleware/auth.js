const jwt = require('jsonwebtoken');
const { query, withGym } = require('../db/db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (process.env.NODE_ENV === 'production') {
  if (!JWT_SECRET) {
    console.error('[Auth] FATAL: JWT_SECRET is not set in production!');
    process.exit(1);
  }
  if (!JWT_REFRESH_SECRET) {
    console.error('[Auth] FATAL: JWT_REFRESH_SECRET is not set in production!');
    process.exit(1);
  }
  if (JWT_REFRESH_SECRET === JWT_SECRET) {
    console.error('[Auth] FATAL: JWT_REFRESH_SECRET must differ from JWT_SECRET.');
    process.exit(1);
  }
}

const secret = JWT_SECRET || 'dev_insecure_secret_DO_NOT_USE_IN_PROD';
// Dev-only fallback. In production we already exited above if it's missing.
const refreshSecret = JWT_REFRESH_SECRET || (secret + '_refresh_dev_only');
if (!JWT_SECRET) console.warn('[Auth] WARNING: JWT_SECRET not set — using insecure dev secret');
if (!JWT_REFRESH_SECRET) console.warn('[Auth] WARNING: JWT_REFRESH_SECRET not set — using derived dev secret');

/**
 * Verify JWT, attach { id, role, gym_id } to req.user.
 * For super_admin, gym_id from JWT is null; req.gymId is resolved from
 * X-Gym-Id header (the target gym they're operating on).
 */
const authenticate = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.split(' ')[1]) || req.cookies?.token;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, secret);
    req.user = decoded;

    // Super-admin (gym_id NULL) is visible without tenant context;
    // tenant users are RLS-filtered, so set context first.
    const userCheck = decoded.gym_id == null
      ? await query('SELECT id, gym_id, role FROM users WHERE id = $1', [decoded.id])
      : await withGym(decoded.gym_id, async (db) =>
          db.query('SELECT id, gym_id, role FROM users WHERE id = $1', [decoded.id])
        );
    if (userCheck.rows.length === 0) {
      return res.status(401).json({ success: false, message: 'User account no longer exists.' });
    }

    const dbUser = userCheck.rows[0];
    if (dbUser.role !== decoded.role || dbUser.gym_id !== decoded.gym_id) {
      return res.status(401).json({ success: false, message: 'Session is stale, please re-login.' });
    }

    if (decoded.role === 'super_admin') {
      const headerGymId = req.headers['x-gym-id'];
      req.gymId = headerGymId ? parseInt(headerGymId, 10) : null;
      if (req.gymId !== null && (!Number.isInteger(req.gymId) || req.gymId <= 0)) {
        return res.status(400).json({ success: false, message: 'Invalid X-Gym-Id header.' });
      }
    } else {
      req.gymId = decoded.gym_id;
    }

    next();
  } catch (err) {
    return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
  }
};

/**
 * Restrict access to specific roles.
 *   router.delete('/foo', authenticate, authorize('admin', 'super_admin'), handler)
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
 * For routes that require a tenant gym context. Run AFTER authenticate.
 * Super-admins must set X-Gym-Id header to use these routes.
 */
const requireGym = (req, res, next) => {
  if (!req.gymId) {
    return res.status(400).json({
      success: false,
      message: req.user?.role === 'super_admin'
        ? 'Super admin must specify X-Gym-Id header for tenant-scoped routes.'
        : 'No gym context available.',
    });
  }
  next();
};

const signToken = (payload, expiresIn = '1h') =>
  jwt.sign(payload, secret, { expiresIn });

const signRefreshToken = (payload) =>
  jwt.sign(payload, refreshSecret, { expiresIn: '7d' });

const verifyRefreshToken = (token) => jwt.verify(token, refreshSecret);
const verifyToken = (token) => jwt.verify(token, secret);

module.exports = {
  authenticate,
  authorize,
  requireGym,
  signToken,
  signRefreshToken,
  verifyRefreshToken,
  verifyToken,
};
