-- A saved meal can log itself every day at a local time. daily_filled_through is the latest local day already
-- filled; it outlives turning the meal off, so turning it back on the same day never fills that day twice.
ALTER TABLE saved_meals
  ADD COLUMN daily_time text CHECK (daily_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN daily_time_zone text,
  ADD COLUMN daily_filled_through date,
  ADD CONSTRAINT saved_meals_daily_check CHECK ((daily_time IS NULL) = (daily_time_zone IS NULL) AND (daily_time IS NULL OR daily_filled_through IS NOT NULL));

CREATE INDEX saved_meals_user_daily_idx ON saved_meals (user_id) WHERE daily_time IS NOT NULL AND deleted_at IS NULL;
