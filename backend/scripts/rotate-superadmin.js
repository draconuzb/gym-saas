#!/usr/bin/env node
// Rotate the platform super_admin's phone+password.
// Usage:  PHONE=+998901234567 node scripts/rotate-superadmin.js
// (PHONE optional — defaults to a placeholder)

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query } = require('../db/db');

const PHONE = process.env.PHONE || '+998900000001';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
function genPassword(len = 20) {
  const buf = crypto.randomBytes(len);
  return Array.from(buf).map(b => alphabet[b % alphabet.length]).join('');
}

(async () => {
  const password = genPassword(20);
  const hash = await bcrypt.hash(password, 12);

  const r = await query(
    `UPDATE users
     SET phone = $1, password_hash = $2
     WHERE role = 'super_admin' AND gym_id IS NULL
     RETURNING id, phone, role, first_name`,
    [PHONE, hash]
  );

  if (r.rows.length === 0) {
    console.error('No super_admin row found.');
    process.exit(1);
  }

  console.log('\n=== Super-admin credentials rotated ===');
  console.log('Phone:    ' + PHONE);
  console.log('Password: ' + password);
  console.log('======================================');
  console.log('Login:    https://gym.bizdaoson.uz/login');
  console.log('Note: store these somewhere safe. The password cannot be recovered.');
  process.exit(0);
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
