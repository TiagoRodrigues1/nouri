-- Foods people add from a label, shared with everyone once reviewed. The person who added one sees it at once.
-- Deleting the account keeps the food, which others may already log, and forgets who added it.
CREATE TABLE community_foods (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  brand text CHECK (char_length(brand) BETWEEN 1 AND 100),
  barcode text CHECK (barcode ~ '^(\d{8}|\d{12,14})$'),
  -- The label's basis: nutrients are per 100 of this unit, and the serving is in it too.
  unit text NOT NULL CHECK (unit IN ('g', 'ml')),
  kcal_milli bigint CHECK (kcal_milli BETWEEN 0 AND 900000),
  protein_milli bigint CHECK (protein_milli BETWEEN 0 AND 100000),
  carbs_milli bigint CHECK (carbs_milli BETWEEN 0 AND 100000),
  fat_milli bigint CHECK (fat_milli BETWEEN 0 AND 100000),
  serving_milli bigint CHECK (serving_milli BETWEEN 1 AND 10000000),
  -- The name and brand without accents or case, which search matches typed words against.
  search_text text NOT NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One reviewed food per barcode, and one submission per person per barcode.
CREATE UNIQUE INDEX community_foods_reviewed_barcode_idx ON community_foods (barcode) WHERE reviewed_at IS NOT NULL;
CREATE UNIQUE INDEX community_foods_user_barcode_idx ON community_foods (user_id, barcode);
CREATE INDEX community_foods_pending_idx ON community_foods (created_at) WHERE reviewed_at IS NULL;
