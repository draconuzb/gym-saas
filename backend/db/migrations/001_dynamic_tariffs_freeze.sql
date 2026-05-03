-- Migration 001: Dynamic Tariff Builder + Freeze (Muzlatish)
-- Safe to run multiple times

-- Dynamic tariff columns on plans
ALTER TABLE plans ADD COLUMN IF NOT EXISTS visit_quota INT;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS calendar_duration_months INT DEFAULT 1;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS allow_multi_entry_per_day BOOLEAN DEFAULT false;

-- Backfill visit_quota from days for existing plans
UPDATE plans SET visit_quota = days WHERE visit_quota IS NULL;

-- Dynamic tariff snapshot columns on subscriptions
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS visit_quota INT;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS calendar_duration_months INT DEFAULT 1;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS allow_multi_entry_per_day BOOLEAN DEFAULT false;

-- Freeze columns
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS frozen_days_saved INT DEFAULT 0;

-- Extend status enum to include 'frozen'
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_status_check;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_status_check
    CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'frozen'));

-- Backfill subscriptions: treat existing active subscriptions as 1-month, quota = total_days
UPDATE subscriptions SET visit_quota = total_days WHERE visit_quota IS NULL;
