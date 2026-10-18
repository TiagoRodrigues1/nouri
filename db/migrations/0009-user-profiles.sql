-- The person's sex, birth year, activity level, and goal direction, from which nutrition targets are suggested.
-- One current row per person: nothing is judged against a past profile, so it keeps no history.
CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  sex text NOT NULL CHECK (sex IN ('female', 'male')),
  birth_year integer NOT NULL CHECK (birth_year BETWEEN 1900 AND 2100),
  activity text NOT NULL CHECK (activity IN ('sedentary', 'light', 'moderate', 'active', 'very-active')),
  goal text NOT NULL CHECK (goal IN ('lose', 'maintain', 'gain')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
