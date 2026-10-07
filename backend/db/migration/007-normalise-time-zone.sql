-- migrate:up
-- Data-only. V8 emits legacy zone names (Asia/Calcutta) that Postgres 18 rejects, and Postgres
-- reads offset ids such as +01:00 with the opposite (POSIX) sign. Remap stored values to
-- Postgres's spelling. Idempotent: a second run matches nothing. Keep the table in sync with
-- LEGACY_TIME_ZONE in src/lib/time-zone.ts.
UPDATE app_user u
SET time_zone = m.modern
FROM (VALUES
  ('Africa/Asmera', 'Africa/Asmara'),
  ('America/Buenos_Aires', 'America/Argentina/Buenos_Aires'),
  ('America/Catamarca', 'America/Argentina/Catamarca'),
  ('America/Cordoba', 'America/Argentina/Cordoba'),
  ('America/Godthab', 'America/Nuuk'),
  ('America/Indianapolis', 'America/Indiana/Indianapolis'),
  ('America/Jujuy', 'America/Argentina/Jujuy'),
  ('America/Louisville', 'America/Kentucky/Louisville'),
  ('America/Mendoza', 'America/Argentina/Mendoza'),
  ('Asia/Calcutta', 'Asia/Kolkata'),
  ('Asia/Katmandu', 'Asia/Kathmandu'),
  ('Asia/Rangoon', 'Asia/Yangon'),
  ('Asia/Saigon', 'Asia/Ho_Chi_Minh'),
  ('Atlantic/Faeroe', 'Atlantic/Faroe'),
  ('Europe/Kiev', 'Europe/Kyiv'),
  ('Pacific/Enderbury', 'Pacific/Kanton'),
  ('Pacific/Ponape', 'Pacific/Pohnpei'),
  ('Pacific/Truk', 'Pacific/Chuuk')
) AS m(legacy, modern)
WHERE lower(u.time_zone) = lower(m.legacy);

-- Fix the case of names Postgres knows under another capitalisation.
UPDATE app_user u
SET time_zone = n.name
FROM pg_timezone_names n
WHERE lower(n.name) = lower(u.time_zone) AND n.name <> u.time_zone;

-- Anything still unknown (offset ids, unmapped names) falls back to UTC.
UPDATE app_user
SET time_zone = 'UTC'
WHERE time_zone NOT IN (SELECT name FROM pg_timezone_names);

-- migrate:down
-- Intentional no-op: the original spelling is not recoverable, and the normalised value is
-- valid for every earlier version of the schema.
SELECT 1;
