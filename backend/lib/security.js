// ============================================================
// Security helpers: client IP extraction, rate limiting, account
// lockout, and phone-redaction for logs.
// ============================================================

/**
 * Extract the real client IP from a request behind Cloudflare.
 * Order: CF-Connecting-IP (set by Cloudflare on every request, strips any
 * client-supplied value), then the leftmost X-Forwarded-For (with
 * trust proxy enabled), then req.ip as last resort.
 */
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf && typeof cf === 'string') return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff && typeof xff === 'string') return xff.split(',')[0].trim();
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Build a per-key rate limiter. `keyFn(req)` returns the bucket key
 * (typically client IP, or `phone` for account lockout). `max` requests
 * are allowed per `windowMs`. Past the limit returns 429 and stops the
 * chain. The bucket is sliding-window: cleared `windowMs` after firstHit.
 */
function rateLimiter({ keyFn, max, windowMs, message = 'Too many requests. Try again later.', name = 'rate' }) {
  const buckets = new Map();
  // Periodic cleanup (every windowMs)
  setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.firstHit > windowMs) buckets.delete(k);
    }
  }, windowMs).unref?.();

  return function rateLimitMw(req, res, next) {
    const key = keyFn(req);
    if (!key) return next();
    const now = Date.now();
    const b = buckets.get(key);
    if (b) {
      if (now - b.firstHit > windowMs) {
        buckets.set(key, { count: 1, firstHit: now });
      } else if (b.count >= max) {
        const retryAfter = Math.ceil((windowMs - (now - b.firstHit)) / 1000);
        res.set('Retry-After', String(retryAfter));
        console.warn(`[${name}] limit hit for key=${redact(key)}; retry-after=${retryAfter}s`);
        return res.status(429).json({ success: false, message });
      } else {
        b.count++;
      }
    } else {
      buckets.set(key, { count: 1, firstHit: now });
    }
    next();
  };
}

/**
 * Account lockout: after N failed attempts on a particular identity
 * (e.g. phone), block further attempts (regardless of source IP) for
 * `lockMs`. Successful login should call `clear(identity)` to reset.
 *
 *   const lockout = accountLockout({ max: 5, windowMs: 15min, lockMs: 15min });
 *   lockout.guard(phone)   // throws { locked, retryAfter } if locked
 *   lockout.fail(phone)    // record a failed attempt
 *   lockout.clear(phone)   // reset after a successful login
 */
function accountLockout({ max = 5, windowMs = 15 * 60 * 1000, lockMs = 15 * 60 * 1000 } = {}) {
  const accounts = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, e] of accounts) {
      if (e.lockedUntil && e.lockedUntil < now) accounts.delete(k);
      else if (!e.lockedUntil && now - e.firstFail > windowMs) accounts.delete(k);
    }
  }, windowMs).unref?.();

  return {
    guard(identity) {
      const e = accounts.get(identity);
      if (e && e.lockedUntil && e.lockedUntil > Date.now()) {
        return { locked: true, retryAfter: Math.ceil((e.lockedUntil - Date.now()) / 1000) };
      }
      return { locked: false };
    },
    fail(identity) {
      const now = Date.now();
      const e = accounts.get(identity) || { count: 0, firstFail: now };
      if (now - e.firstFail > windowMs) {
        e.count = 1;
        e.firstFail = now;
      } else {
        e.count++;
      }
      if (e.count >= max) {
        e.lockedUntil = now + lockMs;
        console.warn(`[lockout] ${redact(identity)} locked for ${Math.ceil(lockMs / 60000)}min after ${e.count} fails`);
      }
      accounts.set(identity, e);
    },
    clear(identity) {
      accounts.delete(identity);
    },
  };
}

/**
 * Redact a phone for logging. +998901234567 -> +998***4567
 */
function redact(value) {
  if (typeof value !== 'string') return '<non-string>';
  if (/^\+?\d/.test(value) && value.length >= 7) {
    return value.slice(0, 4) + '***' + value.slice(-4);
  }
  return value;
}

/**
 * Validate a password meets minimum strength. Returns null if OK,
 * otherwise an error message string. Rule: 8-128 chars, must include
 * at least 3 of: lowercase, uppercase, digit, symbol. Common weak
 * passwords are rejected outright.
 */
const COMMON_WEAK = new Set([
  'password', 'password1', 'admin', 'admin123', 'qwerty', '12345678',
  '123456789', 'letmein', 'welcome1', '11111111', 'qwerty123',
]);

function validatePassword(pwd) {
  if (typeof pwd !== 'string') return 'Parol matn bo\'lishi kerak.';
  if (pwd.length < 8) return 'Parol kamida 8 belgi bo\'lishi kerak.';
  if (pwd.length > 128) return 'Parol 128 belgidan oshmasligi kerak.';
  if (COMMON_WEAK.has(pwd.toLowerCase())) return 'Bu parol juda zaif. Boshqa biror narsa tanlang.';
  const classes =
    Number(/[a-z]/.test(pwd)) +
    Number(/[A-Z]/.test(pwd)) +
    Number(/\d/.test(pwd)) +
    Number(/[^A-Za-z0-9]/.test(pwd));
  if (classes < 3) return 'Parol katta harf, kichik harf, raqam, va maxsus belgilardan kamida 3 turini o\'z ichiga olishi kerak.';
  return null;
}

module.exports = { clientIp, rateLimiter, accountLockout, redact, validatePassword };
