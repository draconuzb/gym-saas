-- Migration: Add birth_date to members + index for birthday cron
ALTER TABLE members ADD COLUMN IF NOT EXISTS birth_date DATE;
CREATE INDEX IF NOT EXISTS idx_members_birth_date ON members (EXTRACT(MONTH FROM birth_date), EXTRACT(DAY FROM birth_date));
