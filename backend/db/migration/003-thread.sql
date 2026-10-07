-- migrate:up
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

-- Per-user generation lock: set while an AI generation runs, taken over after 5 minutes.
ALTER TABLE app_user ADD COLUMN generation_started_at timestamptz NULL;

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
  stop_reason text NULL,
  refusal_category text NULL,
  latency_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_call_user_created_idx ON ai_call (user_id, created_at);

-- migrate:down
DROP TABLE ai_call;
DROP TABLE message;
DROP TABLE thread;
ALTER TABLE app_user DROP COLUMN generation_started_at;
DROP TABLE topic;
