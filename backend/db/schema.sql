-- ============================================================
-- Gym Management System - PostgreSQL Schema
-- ============================================================

BEGIN;

-- 1. Staff accounts (web dashboard login)
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    phone           VARCHAR(20) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'receptionist'
                        CHECK (role IN ('admin', 'receptionist')),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Subscription plans (admin-managed)
CREATE TABLE plans (
    id                         SERIAL PRIMARY KEY,
    name                       VARCHAR(100) NOT NULL,
    emoji                      VARCHAR(10) DEFAULT '',
    price                      INT NOT NULL DEFAULT 0,         -- in UZS
    days                       INT NOT NULL DEFAULT 12,        -- legacy alias for visit_quota
    visit_quota                INT,                            -- sessions allowed (NULL = unlimited, VIP)
    calendar_duration_months   INT DEFAULT 1,                  -- hard expiry by calendar date
    allow_multi_entry_per_day  BOOLEAN DEFAULT false,          -- VIP can enter multiple times/day without burning
    description                TEXT DEFAULT '',
    is_active                  BOOLEAN DEFAULT true,
    sort_order                 INT DEFAULT 0,
    created_at                 TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Gym members (registered via Telegram bot)
CREATE TABLE members (
    id              SERIAL PRIMARY KEY,
    telegram_id     BIGINT UNIQUE,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    phone           VARCHAR(20),
    plan_id         INT REFERENCES plans(id) ON DELETE SET NULL,
    is_active       BOOLEAN DEFAULT true,
    birth_date      DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Subscription purchases
CREATE TABLE subscriptions (
    id                         SERIAL PRIMARY KEY,
    member_id                  INT NOT NULL REFERENCES members(id),
    plan_id                    INT REFERENCES plans(id) ON DELETE SET NULL,
    plan_name                  VARCHAR(100) NOT NULL,  -- snapshot at purchase time
    total_days                 INT NOT NULL,            -- legacy (same as visit_quota when set)
    days_used                  INT NOT NULL DEFAULT 0,
    visit_quota                INT,                     -- snapshot: NULL = unlimited
    calendar_duration_months   INT DEFAULT 1,           -- snapshot: months until hard expiry
    allow_multi_entry_per_day  BOOLEAN DEFAULT false,   -- snapshot
    price                      INT NOT NULL,
    status                     VARCHAR(20) DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'frozen')),
    approved_by                INT REFERENCES users(id),
    frozen_at                  TIMESTAMPTZ,              -- when manager pressed Muzlatish
    frozen_days_saved          INT DEFAULT 0,            -- days banked from freeze
    created_at                 TIMESTAMPTZ DEFAULT NOW(),
    activated_at               TIMESTAMPTZ,
    expires_at                 TIMESTAMPTZ
);

-- 5. Gym visit records (check-ins)
CREATE TABLE checkins (
    id                  SERIAL PRIMARY KEY,
    member_id           INT NOT NULL REFERENCES members(id),
    subscription_id     INT REFERENCES subscriptions(id),
    checked_in_at       TIMESTAMPTZ DEFAULT NOW(),
    approved_by_staff   BOOLEAN DEFAULT false       -- kiosk manager approval
);

-- 7. Payment records with audit trail
CREATE TABLE payments (
    id                  SERIAL PRIMARY KEY,
    member_id           INT NOT NULL REFERENCES members(id),
    subscription_id     INT REFERENCES subscriptions(id),
    amount              INT NOT NULL,               -- in UZS
    gateway             VARCHAR(20) NOT NULL
                            CHECK (gateway IN ('cash', 'payme', 'click')),
    status              VARCHAR(20) DEFAULT 'pending'
                            CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    transaction_ref     VARCHAR(255),
    receipt_url         TEXT,
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Trainer profiles
CREATE TABLE trainers (
    id              SERIAL PRIMARY KEY,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    specialty       VARCHAR(200),
    phone           VARCHAR(20),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Group class schedule
CREATE TABLE classes (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    trainer_id      INT REFERENCES trainers(id),
    day_of_week     VARCHAR(3) NOT NULL
                        CHECK (day_of_week IN ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
    start_time      TIME NOT NULL,
    capacity        INT NOT NULL DEFAULT 15,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Class enrollment records
CREATE TABLE class_enrollments (
    id              SERIAL PRIMARY KEY,
    class_id        INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    member_id       INT NOT NULL REFERENCES members(id),
    enrolled_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(class_id, member_id)
);

-- 11. Telegram admin whitelist
CREATE TABLE bot_admins (
    telegram_id     BIGINT PRIMARY KEY,
    added_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 12. Key-value config store
CREATE TABLE settings (
    key             VARCHAR(100) PRIMARY KEY,
    value           TEXT NOT NULL
);

-- 13. Daily walk-in visitors (no subscription, pay per visit)
CREATE TABLE daily_visits (
    id              SERIAL PRIMARY KEY,
    visitor_name    VARCHAR(100),
    phone           VARCHAR(20),
    amount          INT NOT NULL DEFAULT 0,
    payment_method  VARCHAR(20) DEFAULT 'cash',
    notes           TEXT DEFAULT '',
    visited_at      TIMESTAMPTZ DEFAULT NOW(),
    registered_by   INT REFERENCES users(id)
);

-- 14. Entry codes for kiosk check-in
CREATE TABLE entry_codes (
    id              SERIAL PRIMARY KEY,
    member_id       INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    code            VARCHAR(6) NOT NULL,
    valid_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    used            BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(code, valid_date)  -- only code uniqueness; a member can have multiple codes per day
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_members_telegram_id         ON members(telegram_id);
CREATE INDEX idx_members_birth_date            ON members (EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date));
CREATE INDEX idx_subscriptions_member_status  ON subscriptions(member_id, status);
CREATE INDEX idx_checkins_member_date         ON checkins(member_id, checked_in_at);
CREATE INDEX idx_payments_member              ON payments(member_id);
CREATE INDEX idx_subscriptions_status_plan   ON subscriptions(status, plan_name);
CREATE INDEX idx_daily_visits_date           ON daily_visits(visited_at);
CREATE INDEX idx_entry_codes_date_code       ON entry_codes(valid_date, code);

-- ============================================================
-- Default settings
-- ============================================================

INSERT INTO settings (key, value) VALUES
    ('gym_name',            'GymSystem'),
    ('support_username',    '@gym_support_uz'),
    ('support_phone',       '+998 90 000 00 00');

-- Default plans (L1 fix: include visit_quota and calendar_duration_months)
INSERT INTO plans (name, emoji, price, days, description, sort_order, visit_quota, calendar_duration_months, allow_multi_entry_per_day) VALUES
    ('Oddiy',   '🥉', 200000, 12, 'Zal kirish', 1, 12, 1, false),
    ('Premium', '🥈', 350000, 12, 'Zal + trener', 2, 12, 1, false),
    ('VIP',     '🥇', 550000, 12, 'Zal + trener + jadval', 3, 12, 1, false);

COMMIT;
