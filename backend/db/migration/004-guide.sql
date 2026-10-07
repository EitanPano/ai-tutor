-- migrate:up
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

-- migrate:down
DROP TABLE guide_step;
DROP TABLE guide;
