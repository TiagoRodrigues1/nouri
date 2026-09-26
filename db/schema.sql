CREATE TABLE IF NOT EXISTS food_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  quantity jsonb NOT NULL,
  kcal_milli bigint CHECK (kcal_milli >= 0),
  protein_milli bigint CHECK (protein_milli >= 0),
  carbs_milli bigint CHECK (carbs_milli >= 0),
  fat_milli bigint CHECK (fat_milli >= 0),
  catalog_ref jsonb,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS food_entries_user_day_active_idx ON food_entries (user_id, local_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS mutation_receipts (
  user_id uuid NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  outcome text CHECK (outcome IN ('created', 'updated', 'deleted', 'missing', 'stale', 'key-reuse')),
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key),
  CONSTRAINT mutation_receipts_completed CHECK (
    (outcome IS NULL AND body IS NULL)
    OR (outcome IN ('created', 'updated') AND body IS NOT NULL)
    OR (outcome IN ('deleted', 'missing', 'stale', 'key-reuse') AND body IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS water_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  volume_ml integer NOT NULL CHECK (volume_ml BETWEEN 1 AND 5000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS water_entries_user_day_active_idx ON water_entries (user_id, local_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS dashboard_layouts (
  user_id uuid PRIMARY KEY,
  cards text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS body_measurements (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('weight', 'height', 'body-fat', 'waist')),
  value_milli bigint NOT NULL CHECK (value_milli > 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS body_measurements_user_kind_active_idx ON body_measurements (user_id, kind, local_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS workouts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  activity text NOT NULL CHECK (activity IN ('strength', 'run', 'walk', 'cycle', 'swim', 'other')),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  distance_m integer CHECK (distance_m BETWEEN 1 AND 1000000),
  energy_kcal integer CHECK (energy_kcal BETWEEN 0 AND 10000),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workouts ADD COLUMN IF NOT EXISTS strength_exercises jsonb;

CREATE INDEX IF NOT EXISTS workouts_user_day_active_idx ON workouts (user_id, local_date) WHERE deleted_at IS NULL;

-- A night belongs to the local date on which it ends.
CREATE TABLE IF NOT EXISTS sleep_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  awake_minutes integer CHECK (awake_minutes >= 0),
  light_minutes integer CHECK (light_minutes >= 0),
  deep_minutes integer CHECK (deep_minutes >= 0),
  rem_minutes integer CHECK (rem_minutes >= 0),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at > started_at AND ended_at - started_at <= interval '24 hours'),
  CHECK (num_nulls(awake_minutes, light_minutes, deep_minutes, rem_minutes) IN (0, 4))
);

CREATE INDEX IF NOT EXISTS sleep_sessions_user_day_active_idx ON sleep_sessions (user_id, local_date) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS progress_photos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  image bytea NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS progress_photos_user_day_active_idx ON progress_photos (user_id, local_date) WHERE deleted_at IS NULL;
