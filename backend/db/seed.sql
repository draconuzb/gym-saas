-- ============================================================
-- Initial seed: bootstrap super-admin so the platform is reachable.
-- After first install, IMMEDIATELY rotate the credentials with:
--   PHONE='+998xxxxxxxxx' node backend/scripts/rotate-superadmin.js
-- The shipped password is intentionally awkward to discourage leaving
-- it in place, and the seeded phone uses a placeholder reserved range.
-- ============================================================

BEGIN;

-- Bootstrap super-admin (gym_id NULL = global access).
-- Phone:    +998900000000  (reserved-range placeholder)
-- Password: bootstrap        (bcrypt 10, rotate immediately!)
-- Hash generated with:  bcrypt.hash('bootstrap', 10)
INSERT INTO users (gym_id, phone, password_hash, role, first_name, last_name)
VALUES (
    NULL,
    '+998900000000',
    '$2b$10$mI/hRh4AGhdeO1UynvmkN.r7OSlhfy1HZDeIFoMpmC7TpMZJHwcZi',
    'super_admin',
    'Platform',
    'Admin'
)
ON CONFLICT DO NOTHING;

COMMIT;
