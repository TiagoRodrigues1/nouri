-- A goal becomes a weekly rate instead of a direction with a fixed energy change. Grams, like the goal weight in
-- user_targets. Existing goals keep roughly the change they had: a fifth off maintenance was about half a kilogram a
-- week, and a tenth on about a quarter.
ALTER TABLE user_profiles ADD COLUMN weekly_change_g integer NOT NULL DEFAULT 0
  CHECK (weekly_change_g BETWEEN -1000 AND 500 AND weekly_change_g % 250 = 0);

UPDATE user_profiles SET weekly_change_g = CASE goal WHEN 'lose' THEN -500 WHEN 'gain' THEN 250 ELSE 0 END;

-- Dropping a column fires no trigger, so the storage ledger swaps each row's old size for its new one by hand.
UPDATE account_storage SET bytes = account_storage.bytes - pg_column_size(p)
FROM user_profiles p WHERE p.user_id = account_storage.user_id;

ALTER TABLE user_profiles DROP COLUMN goal;
ALTER TABLE user_profiles ALTER COLUMN weekly_change_g DROP DEFAULT;

UPDATE account_storage SET bytes = account_storage.bytes + pg_column_size(p)
FROM user_profiles p WHERE p.user_id = account_storage.user_id;
