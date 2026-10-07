-- migrate:up
-- Serves the stale-turn probe (unfinished assistant turns), which otherwise scans the user's whole history.
CREATE INDEX message_in_flight_idx ON message (user_id, created_at)
  WHERE role = 'assistant' AND status = 'incomplete' AND stop_reason IS NULL;

-- migrate:down
DROP INDEX message_in_flight_idx;
