-- Routines a person starts strength workouts from. Exercises are named, as in workouts, so deleting a custom
-- exercise leaves the routines that use it unchanged. A started workout copies its routine, so editing the routine
-- later changes nothing already logged.
CREATE TABLE workout_routines (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  -- [{ name, sets: [{ reps: { min, max } }] }]
  exercises jsonb NOT NULL CHECK (jsonb_typeof(exercises) = 'array' AND jsonb_array_length(exercises) BETWEEN 1 AND 20),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX workout_routines_user_active_idx ON workout_routines (user_id, created_at) WHERE deleted_at IS NULL;
