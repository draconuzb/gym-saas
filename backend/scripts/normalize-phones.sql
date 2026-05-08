-- One-shot migration: strip whitespace from stored phone numbers so they
-- match the API's new normalize-on-input behavior.
-- Safe to run multiple times (only touches rows that still have whitespace).

\echo === BEFORE ===
SELECT 'users'         AS t, COUNT(*) FROM users         WHERE phone ~ '\s'
UNION ALL SELECT 'members'      , COUNT(*) FROM members      WHERE phone ~ '\s'
UNION ALL SELECT 'gyms'         , COUNT(*) FROM gyms         WHERE phone ~ '\s'
UNION ALL SELECT 'daily_visits' , COUNT(*) FROM daily_visits WHERE phone ~ '\s'
UNION ALL SELECT 'trainers'     , COUNT(*) FROM trainers     WHERE phone ~ '\s';

UPDATE users         SET phone = regexp_replace(phone, '\s+', '', 'g') WHERE phone ~ '\s';
UPDATE members       SET phone = regexp_replace(phone, '\s+', '', 'g') WHERE phone ~ '\s';
UPDATE gyms          SET phone = regexp_replace(phone, '\s+', '', 'g') WHERE phone IS NOT NULL AND phone ~ '\s';
UPDATE daily_visits  SET phone = regexp_replace(phone, '\s+', '', 'g') WHERE phone IS NOT NULL AND phone ~ '\s';
UPDATE trainers      SET phone = regexp_replace(phone, '\s+', '', 'g') WHERE phone IS NOT NULL AND phone ~ '\s';

\echo === AFTER ===
SELECT 'users'         AS t, COUNT(*) FROM users         WHERE phone ~ '\s'
UNION ALL SELECT 'members'      , COUNT(*) FROM members      WHERE phone ~ '\s'
UNION ALL SELECT 'gyms'         , COUNT(*) FROM gyms         WHERE phone ~ '\s'
UNION ALL SELECT 'daily_visits' , COUNT(*) FROM daily_visits WHERE phone ~ '\s'
UNION ALL SELECT 'trainers'     , COUNT(*) FROM trainers     WHERE phone ~ '\s';
