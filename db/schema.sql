CREATE TABLE food_entries (
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

CREATE INDEX food_entries_user_day_active_idx ON food_entries (user_id, local_date) WHERE deleted_at IS NULL;

CREATE TABLE mutation_receipts (
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

-- A named group of foods copied from logged entries. Items are read and written whole, so they stay one document.
CREATE TABLE saved_meals (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  items jsonb NOT NULL CHECK (jsonb_typeof(items) = 'array' AND jsonb_array_length(items) BETWEEN 1 AND 20),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX saved_meals_user_active_idx ON saved_meals (user_id, created_at) WHERE deleted_at IS NULL;

CREATE TABLE water_entries (
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

CREATE INDEX water_entries_user_day_active_idx ON water_entries (user_id, local_date) WHERE deleted_at IS NULL;

CREATE TABLE dashboard_layouts (
  user_id uuid PRIMARY KEY,
  cards text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per change; a day uses the latest row that took effect on or before it.
CREATE TABLE user_targets (
  user_id uuid NOT NULL,
  effective_from date NOT NULL,
  kcal integer NOT NULL CHECK (kcal > 0),
  protein_g integer NOT NULL CHECK (protein_g > 0),
  carbs_g integer NOT NULL CHECK (carbs_g > 0),
  fat_g integer NOT NULL CHECK (fat_g > 0),
  water_ml integer NOT NULL CHECK (water_ml > 0),
  steps integer NOT NULL CHECK (steps > 0),
  sleep_minutes integer NOT NULL CHECK (sleep_minutes > 0),
  fasting_hours integer NOT NULL CHECK (fasting_hours BETWEEN 1 AND 23),
  burned_kcal integer NOT NULL CHECK (burned_kcal > 0),
  exercise_minutes integer NOT NULL CHECK (exercise_minutes > 0),
  workouts integer NOT NULL CHECK (workouts > 0),
  weight_g integer CHECK (weight_g > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, effective_from)
);

CREATE TABLE body_measurements (
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

CREATE INDEX body_measurements_user_kind_active_idx ON body_measurements (user_id, kind, local_date) WHERE deleted_at IS NULL;

CREATE TABLE workouts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  activity text NOT NULL CHECK (activity IN ('strength', 'run', 'walk', 'cycle', 'swim', 'other')),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 1440),
  distance_m integer CHECK (distance_m BETWEEN 1 AND 1000000),
  energy_kcal integer CHECK (energy_kcal BETWEEN 0 AND 10000),
  strength_exercises jsonb,
  -- Imported workouts keep their provider identity; manual workouts use the defaults.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'google-health')),
  source_id text,
  source_fingerprint text,
  source_device text,
  source_title text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workouts_source_identity CHECK (
    (source = 'manual' AND source_id IS NULL AND source_fingerprint IS NULL AND source_title IS NULL)
    OR (source <> 'manual' AND source_id IS NOT NULL AND source_fingerprint IS NOT NULL)
  )
);

CREATE INDEX workouts_user_day_active_idx ON workouts (user_id, local_date) WHERE deleted_at IS NULL;
-- Deleted imports keep their row, so a record the source restores revives instead of duplicating.
CREATE UNIQUE INDEX workouts_user_source_idx ON workouts (user_id, source, source_id) WHERE source_id IS NOT NULL;

-- A night belongs to the local date on which it ends.
CREATE TABLE sleep_sessions (
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
  -- Imported sleep keeps its provider identity; manual sleep uses the defaults.
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'google-health')),
  source_id text,
  source_fingerprint text,
  source_device text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ended_at > started_at AND ended_at - started_at <= interval '24 hours'),
  CHECK (num_nulls(awake_minutes, light_minutes, deep_minutes, rem_minutes) IN (0, 4)),
  CONSTRAINT sleep_sessions_source_identity CHECK (
    (source = 'manual' AND source_id IS NULL AND source_fingerprint IS NULL)
    OR (source <> 'manual' AND source_id IS NOT NULL AND source_fingerprint IS NOT NULL)
  )
);

CREATE INDEX sleep_sessions_user_day_active_idx ON sleep_sessions (user_id, local_date) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX sleep_sessions_user_source_idx ON sleep_sessions (user_id, source, source_id) WHERE source_id IS NOT NULL;

CREATE TABLE progress_photos (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
  image bytea NOT NULL,
  -- A small JPEG the page makes before uploading. Older local photos may have none.
  thumbnail bytea CHECK (octet_length(thumbnail) BETWEEN 1 AND 262144),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX progress_photos_user_day_active_idx ON progress_photos (user_id, local_date) WHERE deleted_at IS NULL;

-- One row per change; a day uses the latest list that took effect on or before it.
CREATE TABLE supplement_stacks (
  user_id uuid NOT NULL,
  effective_from date NOT NULL,
  supplements jsonb NOT NULL CHECK (jsonb_typeof(supplements) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, effective_from)
);

CREATE TABLE supplement_intakes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  local_date date NOT NULL,
  supplement_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  kind text NOT NULL CHECK (kind IN ('vitamin', 'mineral', 'creatine', 'omega-3', 'other')),
  dose jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX supplement_intakes_user_day_active_idx ON supplement_intakes (user_id, local_date) WHERE deleted_at IS NULL;

-- One row per cloud provider the person connected, such as Google Health.
CREATE TABLE wearable_connections (
  user_id uuid NOT NULL,
  provider text NOT NULL,
  scope text NOT NULL,
  -- AES-256-GCM ciphertext; the key is WEARABLE_TOKEN_KEY and never reaches the database.
  refresh_token text,
  access_token text,
  access_token_expires_at timestamptz,
  last_synced_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);

-- One row per sign-in attempt; the callback consumes it, so a state works once.
CREATE TABLE wearable_oauth_states (
  state_hash text PRIMARY KEY,
  user_id uuid NOT NULL,
  provider text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One row per person. Every user_id above refers to users.id; Clerk owns sign-in and is named only here.
CREATE TABLE users (
  id uuid PRIMARY KEY,
  clerk_user_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
