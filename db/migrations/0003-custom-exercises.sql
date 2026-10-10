-- Exercises a person adds to the library beside the built-in catalog. Workouts still record exercises by name,
-- so deleting one leaves the workouts that used it unchanged.
CREATE TABLE custom_exercises (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- exerciseKey(name): one spelling per exercise, which the history matches workouts by.
  key text NOT NULL,
  muscle text NOT NULL,
  equipment text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX custom_exercises_user_key_active_idx ON custom_exercises (user_id, key) WHERE deleted_at IS NULL;
