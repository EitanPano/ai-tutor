-- migrate:up
-- Serves the global daily token cap, which sums ai_call across all users by created_at.
CREATE INDEX ai_call_created_idx ON ai_call (created_at);

-- migrate:down
DROP INDEX ai_call_created_idx;
