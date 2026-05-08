/**
 * Strip whitespace from a phone string so "+998 99 100 20 30",
 * "+998991002030", and "+998 99-100-20-30" all compare equal.
 * Returns null/undefined as-is so callers can keep their own optional handling.
 */
function normalizePhone(phone) {
  if (phone === null || phone === undefined) return phone;
  if (typeof phone !== 'string') return phone;
  return phone.replace(/\s+/g, '');
}

module.exports = { normalizePhone };
