-- Migration 003: Audit fixes
-- Add index on payments.created_at for date-range queries and reports

CREATE INDEX IF NOT EXISTS idx_payments_created ON payments(created_at);
