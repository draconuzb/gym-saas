-- Telegram allows only one long-poll session per bot, so two gyms sharing a
-- bot token will fight for updates and one will silently break.
-- Enforce uniqueness at the DB level too, in case the API check is bypassed.
-- Partial index so multiple NULLs are allowed (most gyms have no token yet).

CREATE UNIQUE INDEX IF NOT EXISTS idx_gyms_unique_bot_token
  ON gyms (telegram_bot_token)
  WHERE telegram_bot_token IS NOT NULL;
