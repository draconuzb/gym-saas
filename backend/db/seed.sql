-- ============================================================
-- Initial seed: super-admin user only.
-- Gyms are created via the super-admin panel after first login.
-- ============================================================

BEGIN;

-- Platform super-admin (gym_id NULL = global access across all gyms)
-- Default password: 'admin123' (bcrypt 10 rounds).
-- IMPORTANT: change this password on first login.
INSERT INTO users (gym_id, phone, password_hash, role, first_name, last_name)
VALUES (
    NULL,
    '+998901234567',
    '$2b$10$HfdQPbE.AUnzhyPUAWcmdeuRuCk00FQh3bn4HH7LsyaHHv8LjwH6G',
    'super_admin',
    'Super',
    'Admin'
)
ON CONFLICT DO NOTHING;

COMMIT;
