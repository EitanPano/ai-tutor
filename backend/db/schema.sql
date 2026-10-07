-- Full bootstrap schema for a fresh database.
-- This file MUST change together with backend/db/migration/*.sql. The migration test
-- (tests/integration/migration.test.ts) fails when the two drift apart.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE app_user (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  time_zone text NOT NULL,
  -- When the time zone last changed (null: never). One change per 24 hours keeps the daily AI budget window from being reset.
  time_zone_changed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  -- Per-user generation lock: set while an AI generation runs, taken over after 10 minutes.
  generation_started_at timestamptz NULL
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

CREATE TABLE topic (
  id text PRIMARY KEY,
  name text NOT NULL,
  position integer NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Reference data: the frozen topic taxonomy, in display order.
INSERT INTO topic (id, name, position) VALUES
  ('react', 'React', 1),
  ('typescript', 'TypeScript', 2),
  ('javascript', 'JavaScript', 3),
  ('node', 'Node.js', 4),
  ('css', 'CSS', 5),
  ('sql', 'SQL', 6),
  ('git', 'Git', 7),
  ('docker', 'Docker', 8),
  ('testing', 'Testing', 9),
  ('python', 'Python', 10),
  ('algorithms', 'Algorithms and data structures', 11),
  ('other', 'Other', 12)
ON CONFLICT DO NOTHING;

CREATE TABLE thread (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES topic(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);
CREATE INDEX thread_user_updated_idx ON thread (user_id, updated_at DESC, id DESC);

CREATE TABLE message (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  thread_id text NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  status text NOT NULL CHECK (status IN ('complete', 'incomplete', 'failed')),
  stop_reason text NULL CHECK (
    stop_reason IN ('end_turn', 'max_tokens', 'stop_sequence', 'refusal', 'aborted', 'error')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_thread_created_idx ON message (thread_id, created_at);
CREATE INDEX message_user_created_idx ON message (user_id, created_at);

CREATE TABLE ai_call (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('explain', 'guide', 'quiz')),
  model text NOT NULL,
  input_token integer NOT NULL,
  output_token integer NOT NULL,
  cache_read_token integer NOT NULL,
  cache_creation_token integer NOT NULL DEFAULT 0,
  stop_reason text NULL,
  refusal_category text NULL,
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_call_user_created_idx ON ai_call (user_id, created_at);

CREATE TABLE guide (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  thread_id text NOT NULL REFERENCES thread(id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES topic(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guide_user_created_idx ON guide (user_id, created_at);
CREATE INDEX guide_thread_idx ON guide (thread_id);

CREATE TABLE guide_step (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  guide_id text NOT NULL REFERENCES guide(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 8),
  title text NOT NULL,
  body text NOT NULL,
  code text NULL,
  code_language text NULL,
  hint text NOT NULL,
  hint_revealed_at timestamptz NULL,
  done_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guide_id, position)
);
CREATE INDEX guide_step_user_done_idx ON guide_step (user_id, done_at);

CREATE TABLE quiz (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  thread_id text NULL REFERENCES thread(id) ON DELETE CASCADE,
  topic_id text NOT NULL REFERENCES topic(id),
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quiz_user_created_idx ON quiz (user_id, created_at);
CREATE INDEX quiz_thread_idx ON quiz (thread_id);

CREATE TABLE quiz_item (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  quiz_id text NOT NULL REFERENCES quiz(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 5),
  prompt text NOT NULL,
  choice jsonb NOT NULL,
  answer_index integer NOT NULL CHECK (answer_index BETWEEN 0 AND 3),
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quiz_id, position)
);
CREATE INDEX quiz_item_user_idx ON quiz_item (user_id);

CREATE TABLE quiz_attempt (
  id text PRIMARY KEY DEFAULT uuidv7()::text,
  quiz_id text NOT NULL REFERENCES quiz(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  answer jsonb NOT NULL,
  score integer NOT NULL,
  total integer NOT NULL,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quiz_attempt_user_submitted_idx ON quiz_attempt (user_id, submitted_at);
CREATE INDEX quiz_attempt_quiz_submitted_idx ON quiz_attempt (quiz_id, submitted_at);
