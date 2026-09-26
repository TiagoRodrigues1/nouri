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
