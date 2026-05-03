-- ============================================================
-- Gym Management System — Multi-Tenant SaaS Schema (v2)
-- ============================================================
-- Each gym is a tenant. All data is isolated by gym_id.
-- Postgres Row-Level Security (RLS) enforces tenant isolation
-- at the database level — even if app code forgets a WHERE.
-- ============================================================

BEGIN;

-- ============================================================
-- 0. Tenants (gyms) — top-level entity
-- ============================================================
CREATE TABLE gyms (
    id                      SERIAL PRIMARY KEY,
    slug                    VARCHAR(50) UNIQUE NOT NULL,
    name                    VARCHAR(100) NOT NULL,
    phone                   VARCHAR(20),
    address                 TEXT,
    timezone                VARCHAR(50) NOT NULL DEFAULT 'Asia/Tashkent',

    -- Per-gym secrets (each gym has its own bot, QR signing key, hardware key)
    telegram_bot_token      VARCHAR(255),
    telegram_bot_username   VARCHAR(50),
    qr_hmac_secret          VARCHAR(128) NOT NULL,
    hardware_secret         VARCHAR(128) NOT NULL,

    -- SaaS metadata
    is_active               BOOLEAN NOT NULL DEFAULT true,
    plan                    VARCHAR(20) NOT NULL DEFAULT 'standard'
                                CHECK (plan IN ('trial', 'standard', 'premium')),
    trial_ends_at           TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_gyms_slug ON gyms(slug);
CREATE INDEX idx_gyms_active ON gyms(is_active) WHERE is_active = true;

-- ============================================================
-- 1. Staff accounts (web dashboard login)
-- ============================================================
-- gym_id NULL = super_admin (cross-gym access)
-- (gym_id, phone) is unique — same phone can exist in different gyms
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    gym_id          INT REFERENCES gyms(id) ON DELETE CASCADE,
    phone           VARCHAR(20) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'receptionist'
                        CHECK (role IN ('admin', 'receptionist', 'super_admin')),
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK ((role = 'super_admin' AND gym_id IS NULL) OR
           (role <> 'super_admin' AND gym_id IS NOT NULL))
);

CREATE UNIQUE INDEX idx_users_gym_phone ON users(gym_id, phone) WHERE gym_id IS NOT NULL;
CREATE UNIQUE INDEX idx_users_super_phone ON users(phone) WHERE gym_id IS NULL;

-- ============================================================
-- 2. Subscription plans (per gym)
-- ============================================================
CREATE TABLE plans (
    id                         SERIAL PRIMARY KEY,
    gym_id                     INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name                       VARCHAR(100) NOT NULL,
    emoji                      VARCHAR(10) DEFAULT '',
    price                      INT NOT NULL DEFAULT 0,
    days                       INT NOT NULL DEFAULT 12,
    visit_quota                INT,
    calendar_duration_months   INT DEFAULT 1,
    allow_multi_entry_per_day  BOOLEAN DEFAULT false,
    description                TEXT DEFAULT '',
    is_active                  BOOLEAN DEFAULT true,
    sort_order                 INT DEFAULT 0,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_plans_gym_active ON plans(gym_id, is_active);

-- ============================================================
-- 3. Members (per gym)
-- ============================================================
CREATE TABLE members (
    id              SERIAL PRIMARY KEY,
    gym_id          INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    telegram_id     BIGINT,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    phone           VARCHAR(20),
    plan_id         INT REFERENCES plans(id) ON DELETE SET NULL,
    is_active       BOOLEAN DEFAULT true,
    birth_date      DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_members_gym_telegram ON members(gym_id, telegram_id) WHERE telegram_id IS NOT NULL;
CREATE INDEX idx_members_gym ON members(gym_id);
CREATE INDEX idx_members_birth_date ON members(gym_id, EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date));

-- ============================================================
-- 4. Subscriptions (per gym)
-- ============================================================
CREATE TABLE subscriptions (
    id                         SERIAL PRIMARY KEY,
    gym_id                     INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id                  INT NOT NULL REFERENCES members(id),
    plan_id                    INT REFERENCES plans(id) ON DELETE SET NULL,
    plan_name                  VARCHAR(100) NOT NULL,
    total_days                 INT NOT NULL,
    days_used                  INT NOT NULL DEFAULT 0,
    visit_quota                INT,
    calendar_duration_months   INT DEFAULT 1,
    allow_multi_entry_per_day  BOOLEAN DEFAULT false,
    price                      INT NOT NULL,
    status                     VARCHAR(20) DEFAULT 'pending'
                                   CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'frozen')),
    approved_by                INT REFERENCES users(id),
    frozen_at                  TIMESTAMPTZ,
    frozen_days_saved          INT DEFAULT 0,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    activated_at               TIMESTAMPTZ,
    expires_at                 TIMESTAMPTZ
);
CREATE INDEX idx_subscriptions_gym ON subscriptions(gym_id);
CREATE INDEX idx_subscriptions_member_status ON subscriptions(member_id, status);
CREATE INDEX idx_subscriptions_status_plan ON subscriptions(gym_id, status, plan_name);

-- ============================================================
-- 5. Check-ins
-- ============================================================
CREATE TABLE checkins (
    id                  SERIAL PRIMARY KEY,
    gym_id              INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id           INT NOT NULL REFERENCES members(id),
    subscription_id     INT REFERENCES subscriptions(id),
    checked_in_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_by_staff   BOOLEAN DEFAULT false
);
CREATE INDEX idx_checkins_gym_date ON checkins(gym_id, checked_in_at);
CREATE INDEX idx_checkins_member_date ON checkins(member_id, checked_in_at);

-- ============================================================
-- 6. Payments
-- ============================================================
CREATE TABLE payments (
    id                  SERIAL PRIMARY KEY,
    gym_id              INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id           INT NOT NULL REFERENCES members(id),
    subscription_id     INT REFERENCES subscriptions(id),
    amount              INT NOT NULL,
    gateway             VARCHAR(20) NOT NULL
                            CHECK (gateway IN ('cash', 'payme', 'click')),
    status              VARCHAR(20) DEFAULT 'pending'
                            CHECK (status IN ('pending', 'completed', 'failed', 'refunded')),
    transaction_ref     VARCHAR(255),
    receipt_url         TEXT,
    processed_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_payments_gym_member ON payments(gym_id, member_id);
CREATE INDEX idx_payments_gym_created ON payments(gym_id, created_at);
CREATE INDEX idx_payments_status ON payments(gym_id, status);

-- ============================================================
-- 7. Trainers
-- ============================================================
CREATE TABLE trainers (
    id              SERIAL PRIMARY KEY,
    gym_id          INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    first_name      VARCHAR(100) NOT NULL,
    last_name       VARCHAR(100),
    specialty       VARCHAR(200),
    phone           VARCHAR(20),
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_trainers_gym ON trainers(gym_id, is_active);

-- ============================================================
-- 8. Group classes
-- ============================================================
CREATE TABLE classes (
    id              SERIAL PRIMARY KEY,
    gym_id          INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,
    trainer_id      INT REFERENCES trainers(id),
    day_of_week     VARCHAR(3) NOT NULL
                        CHECK (day_of_week IN ('Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun')),
    start_time      TIME NOT NULL,
    capacity        INT NOT NULL DEFAULT 15,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_classes_gym ON classes(gym_id);

-- ============================================================
-- 9. Class enrollments
-- ============================================================
CREATE TABLE class_enrollments (
    id              SERIAL PRIMARY KEY,
    gym_id          INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    class_id        INT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    member_id       INT NOT NULL REFERENCES members(id),
    enrolled_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(class_id, member_id)
);
CREATE INDEX idx_enrollments_gym ON class_enrollments(gym_id);

-- ============================================================
-- 10. Bot admins (per gym)
-- ============================================================
CREATE TABLE bot_admins (
    gym_id          INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    telegram_id     BIGINT NOT NULL,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (gym_id, telegram_id)
);

-- ============================================================
-- 11. Per-gym settings (key-value)
-- ============================================================
CREATE TABLE settings (
    gym_id          INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    key             VARCHAR(100) NOT NULL,
    value           TEXT NOT NULL,
    PRIMARY KEY (gym_id, key)
);

-- ============================================================
-- 12. Daily walk-in visitors
-- ============================================================
CREATE TABLE daily_visits (
    id              SERIAL PRIMARY KEY,
    gym_id          INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    visitor_name    VARCHAR(100),
    phone           VARCHAR(20),
    amount          INT NOT NULL DEFAULT 0,
    payment_method  VARCHAR(20) DEFAULT 'cash',
    notes           TEXT DEFAULT '',
    visited_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    registered_by   INT REFERENCES users(id)
);
CREATE INDEX idx_daily_visits_gym_date ON daily_visits(gym_id, visited_at);

-- ============================================================
-- 13. Entry codes
-- ============================================================
CREATE TABLE entry_codes (
    id              SERIAL PRIMARY KEY,
    gym_id          INT NOT NULL REFERENCES gyms(id) ON DELETE CASCADE,
    member_id       INT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    code            VARCHAR(6) NOT NULL,
    valid_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    used            BOOLEAN DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(gym_id, code, valid_date)
);
CREATE INDEX idx_entry_codes_lookup ON entry_codes(gym_id, valid_date, code);

-- ============================================================
-- Row-Level Security (RLS) — tenant isolation at DB layer
-- ============================================================
-- App must call: SET LOCAL app.current_gym_id = <id> before queries.
-- Reads current_setting() defensively — returns NULL if unset, which
-- causes RLS to filter out all rows (fail-safe).

CREATE OR REPLACE FUNCTION current_gym_id() RETURNS INT
LANGUAGE plpgsql STABLE
AS $$
BEGIN
    RETURN current_setting('app.current_gym_id', true)::int;
EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

DO $$
DECLARE
    t TEXT;
    tables TEXT[] := ARRAY[
        'plans', 'members', 'subscriptions', 'checkins', 'payments',
        'trainers', 'classes', 'class_enrollments', 'bot_admins',
        'settings', 'daily_visits', 'entry_codes'
    ];
BEGIN
    FOREACH t IN ARRAY tables LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I
             USING (gym_id = current_gym_id())
             WITH CHECK (gym_id = current_gym_id())', t);
    END LOOP;
END $$;

-- users: super_admin (gym_id IS NULL) is also visible
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON users
    USING (gym_id = current_gym_id() OR gym_id IS NULL)
    WITH CHECK (gym_id = current_gym_id() OR gym_id IS NULL);

COMMIT;
