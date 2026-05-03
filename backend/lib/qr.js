const crypto = require('crypto');

const QR_SECRET = process.env.QR_HMAC_SECRET || 'dev_' + require('crypto').randomBytes(16).toString('hex');
const QR_TTL_MS = 5 * 60 * 1000; // 5 minutes

function makeQrToken(telegramId) {
  const payload = `GYM|${telegramId}|${Date.now()}`;
  const sig = crypto.createHmac('sha256', QR_SECRET).update(payload).digest('hex');
  return `${payload}|${sig}`;
}

function verifyQrToken(token) {
  try {
    const parts = token.split('|');
    if (parts.length !== 4 || parts[0] !== 'GYM') return null;
    const [prefix, telegramId, ts, sig] = parts;
    const expected = crypto.createHmac('sha256', QR_SECRET).update(`${prefix}|${telegramId}|${ts}`).digest('hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
    if (Date.now() - parseInt(ts) > QR_TTL_MS) return null;
    return { telegramId };
  } catch {
    return null;
  }
}

module.exports = { makeQrToken, verifyQrToken };
