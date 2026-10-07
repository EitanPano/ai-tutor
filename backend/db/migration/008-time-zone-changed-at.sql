-- migrate:up
-- One time-zone change per 24 hours: the daily AI budget window follows the zone, so free changes
-- would reset it. Null means never changed, so the first change after sign-up is allowed.
ALTER TABLE app_user ADD COLUMN time_zone_changed_at timestamptz NULL;

-- migrate:down
ALTER TABLE app_user DROP COLUMN time_zone_changed_at;
