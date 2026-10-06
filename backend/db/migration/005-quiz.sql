-- migrate:up
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

-- migrate:down
DROP TABLE quiz_attempt;
DROP TABLE quiz_item;
DROP TABLE quiz;
