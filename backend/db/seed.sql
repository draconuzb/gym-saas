-- ================================================================
-- GymSystem - Seed Data for Development & Demo
-- Run AFTER schema.sql
-- ================================================================

BEGIN;

-- ─── Admin user ──────────────────────────────────────────────
-- NOTE: Replace the password_hash below with a real bcrypt hash
-- of 'admin123'. Generate with:
--   node -e "require('bcrypt').hash('admin123',10).then(h=>console.log(h))"
INSERT INTO users (phone, password_hash, role, first_name, last_name) VALUES
    ('+998901234567',
     '$2b$10$HfdQPbE.AUnzhyPUAWcmdeuRuCk00FQh3bn4HH7LsyaHHv8LjwH6G',  -- password: admin123
     'admin',
     'Asadbek',
     'Nazarov');

-- ─── Trainers ────────────────────────────────────────────────
INSERT INTO trainers (first_name, last_name, specialty, phone) VALUES
    ('Sardor',  'Yusupov',  'Strength & Conditioning', '+998901112233'),
    ('Dilnoza', 'Karimova', 'Yoga & Pilates',          '+998912223344'),
    ('Bekzod',  'Tursunov', 'CrossFit',                '+998913334455'),
    ('Jasur',   'Mirzayev', 'Boxing & MMA',            '+998914445566');

-- ─── Classes ─────────────────────────────────────────────────
-- trainer_id values correspond to the trainers inserted above (1-4)
INSERT INTO classes (name, trainer_id, day_of_week, start_time, capacity) VALUES
    ('Morning Strength',  1, 'Mon', '07:00', 20),
    ('Yoga Flow',         2, 'Tue', '09:00', 15),
    ('CrossFit WOD',      3, 'Wed', '18:00', 12),
    ('Boxing Basics',     4, 'Thu', '17:00', 10),
    ('Pilates Core',      2, 'Fri', '10:00', 15),
    ('Open Gym Session',  1, 'Sat', '08:00', 25);

COMMIT;
