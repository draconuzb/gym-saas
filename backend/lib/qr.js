const crypto = require('crypto');

const QR_TTL_MS = 5 * 60 * 1000;
const PREFIX = 'GYM';

/**
 * Build a per-gym signed QR token. Format: GYM|gymId|telegramId|ts|hexSig
 * The signature uses the gym's own qr_hmac_secret, so a token signed
 * for gym A cannot be replayed at gym B.
 */
function makeQrToken(gymId, telegramId, secret) {
  if (!secret) throw new Error('makeQrToken: secret is required');
  const payload = `${PREFIX}|${gymId}|${telegramId}|${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}|${sig}`;
}

/**
 * Verify a QR token using the given gym's secret. Returns
 * { gymId, telegramId } on success, null on failure.
 */
function verifyQrToken(token, secret) {
  if (!secret) return null;
  try {
    const parts = token.split('|');
    if (parts.length !== 5 || parts[0] !== PREFIX) return null;
    const [prefix, gymId, telegramId, ts, sig] = parts;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${prefix}|${gymId}|${telegramId}|${ts}`)
      .digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    if (Date.now() - parseInt(ts, 10) > QR_TTL_MS) return null;
    return { gymId: parseInt(gymId, 10), telegramId: parseInt(telegramId, 10) };
  } catch {
    return null;
  }
}

/**
 * Constant-time string comparison (for hardware_secret etc.).
 */
function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

module.exports = { makeQrToken, verifyQrToken, safeCompare };
