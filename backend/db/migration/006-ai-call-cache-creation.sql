-- migrate:up
-- Prompt-cache writes are billed (and count toward the daily budget) but were not recorded.
ALTER TABLE ai_call ADD COLUMN cache_creation_token integer NOT NULL DEFAULT 0;

-- migrate:down
ALTER TABLE ai_call DROP COLUMN cache_creation_token;
