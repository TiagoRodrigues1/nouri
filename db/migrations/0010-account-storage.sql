-- How many bytes of records each person stores, kept by the tables themselves so every write path counts: the
-- API, MCP, daily meal fills, and imports. Photos keep their own quota; retry receipts and sign-in states expire.
CREATE TABLE account_storage (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  bytes bigint NOT NULL DEFAULT 0
);

-- A new row past 128 MiB for its person, or 2 GiB for the app, is refused with SQLSTATE 53Q01 (see
-- src/account/storage.ts). Edits and deletions never are, so a full account can still change what it has.
-- The account check is exact (its ledger row is locked); the app-wide sum cannot see other accounts' uncommitted
-- rows, so concurrent writers may pass it by what they have in flight, rather than every insert waiting on one lock.
CREATE FUNCTION track_account_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stored bigint;
BEGIN
  -- Only an update; a deleted person's ledger row is gone already or going with them.
  IF TG_OP <> 'INSERT' AND OLD.user_id IS NOT NULL THEN
    UPDATE account_storage SET bytes = bytes - pg_column_size(OLD) WHERE user_id = OLD.user_id;
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.user_id IS NOT NULL THEN
    INSERT INTO account_storage (user_id, bytes) VALUES (NEW.user_id, pg_column_size(NEW))
    ON CONFLICT (user_id) DO UPDATE SET bytes = account_storage.bytes + EXCLUDED.bytes
    RETURNING bytes INTO stored;

    IF TG_OP = 'INSERT' AND (stored > 134217728 OR (SELECT sum(bytes) FROM account_storage) > 2147483648) THEN
      RAISE EXCEPTION 'Storage allowance reached' USING ERRCODE = '53Q01';
    END IF;
  END IF;

  RETURN NULL;
END $$;

DO $$
DECLARE
  tracked text;
BEGIN
  FOREACH tracked IN ARRAY ARRAY[
    'food_entries', 'community_foods', 'saved_meals', 'meal_logs', 'water_entries', 'body_measurements', 'workouts',
    'custom_exercises', 'workout_routines', 'sleep_sessions', 'daily_activity', 'daily_heart_rate', 'dashboard_layouts',
    'user_targets', 'user_profiles', 'supplement_stacks', 'supplement_intakes'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION track_account_storage()', tracked || '_storage', tracked);
    EXECUTE format('INSERT INTO account_storage (user_id, bytes) SELECT user_id, sum(pg_column_size(t)) FROM %I t WHERE user_id IS NOT NULL GROUP BY user_id
      ON CONFLICT (user_id) DO UPDATE SET bytes = account_storage.bytes + EXCLUDED.bytes', tracked);
  END LOOP;
END $$;
