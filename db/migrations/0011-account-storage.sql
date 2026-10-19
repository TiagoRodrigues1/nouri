-- How many bytes of records each person stores, kept by the tables themselves so every write path counts: the
-- API, MCP, daily meal fills, and imports. Photos keep their own quota; retry receipts and sign-in states expire.
CREATE TABLE account_storage (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  bytes bigint NOT NULL DEFAULT 0
);

-- Rows nobody owns any more, such as community foods whose author erased their account, still count app-wide.
CREATE TABLE unowned_storage (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  bytes bigint NOT NULL DEFAULT 0
);

INSERT INTO unowned_storage DEFAULT VALUES;

-- A new row past 128 MiB for its person, or 2 GiB for the app, is refused with SQLSTATE 53Q01 (see
-- src/account/storage.ts), and so is an edit that grows a row past them. Deletions, soft ones included, never are,
-- so a full account can still remove what it has.
-- The account check is exact (its ledger row is locked); the app-wide sum cannot see other accounts' uncommitted
-- rows, so concurrent writers may pass it by what they have in flight, rather than every insert waiting on one lock.
CREATE FUNCTION track_account_storage() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  stored bigint;
BEGIN
  -- Only an update; a deleted person's ledger row is gone already or going with them. A row from before accounts
  -- existed (see 0002) has an owner with no ledger row, so an edit that keeps that owner moves its bytes out of the
  -- unowned total instead. Deleting one subtracts nothing, which leaves the total high rather than low.
  IF TG_OP <> 'INSERT' AND OLD.user_id IS NOT NULL THEN
    UPDATE account_storage SET bytes = bytes - pg_column_size(OLD) WHERE user_id = OLD.user_id;

    IF NOT FOUND AND TG_OP = 'UPDATE' AND NEW.user_id = OLD.user_id THEN
      UPDATE unowned_storage SET bytes = bytes - pg_column_size(OLD);
    END IF;
  ELSIF TG_OP <> 'INSERT' THEN
    UPDATE unowned_storage SET bytes = bytes - pg_column_size(OLD);
  END IF;

  IF TG_OP <> 'DELETE' AND EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id) THEN
    INSERT INTO account_storage (user_id, bytes) VALUES (NEW.user_id, pg_column_size(NEW))
    ON CONFLICT (user_id) DO UPDATE SET bytes = account_storage.bytes + EXCLUDED.bytes
    RETURNING bytes INTO stored;

    -- Setting a removal marker (deleted_at, or an assistant's disconnected_at) grows a row by a timestamp, and is
    -- allowed on a full account like any other way of removing something.
    IF (TG_OP = 'INSERT' OR (pg_column_size(NEW) > pg_column_size(OLD) AND NOT EXISTS (
        SELECT 1 FROM unnest(ARRAY['deleted_at', 'disconnected_at']) AS marker
        WHERE to_jsonb(OLD) ->> marker IS NULL AND to_jsonb(NEW) ->> marker IS NOT NULL)))
      AND (stored > 134217728 OR (SELECT sum(bytes) FROM account_storage) + (SELECT bytes FROM unowned_storage) > 2147483648) THEN
      RAISE EXCEPTION 'Storage allowance reached' USING ERRCODE = '53Q01';
    END IF;
  ELSIF TG_OP <> 'DELETE' THEN
    UPDATE unowned_storage SET bytes = bytes + pg_column_size(NEW);
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
    'user_targets', 'user_profiles', 'supplement_stacks', 'supplement_intakes', 'assistant_connections'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION track_account_storage()', tracked || '_storage', tracked);
    -- Rows from before accounts existed may name an API_USER_ID no users row has (see 0002); they count as unowned.
    EXECUTE format('INSERT INTO account_storage (user_id, bytes) SELECT t.user_id, sum(pg_column_size(t)) FROM %I t WHERE EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id) GROUP BY t.user_id
      ON CONFLICT (user_id) DO UPDATE SET bytes = account_storage.bytes + EXCLUDED.bytes', tracked);
    EXECUTE format('UPDATE unowned_storage SET bytes = bytes + (SELECT coalesce(sum(pg_column_size(t)), 0) FROM %I t WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = t.user_id))', tracked);
  END LOOP;
END $$;
