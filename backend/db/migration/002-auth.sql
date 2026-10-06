-- migrate:up
CREATE TABLE app_user (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  time_zone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE TABLE session (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_id_idx ON session (user_id);

-- Owned by rate-limiter-flexible (RateLimiterPostgres): key/points/expire is the shape the
-- library reads and writes, so this table has no id or user_id.
CREATE TABLE rate_limit (
  key varchar(255) PRIMARY KEY,
  points integer NOT NULL DEFAULT 0,
  expire bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE rate_limit;
DROP TABLE session;
DROP TABLE app_user;
