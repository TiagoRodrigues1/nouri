-- One logging of a saved meal: by hand, or one day of a daily meal's fill. It keeps the meal's name from when it was
-- logged, and the food entries it added point back at it, so the whole meal can be removed at once. The latest
-- log made by hand and not removed ranks the meal in lists.
CREATE TABLE meal_logs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  saved_meal_id uuid NOT NULL REFERENCES saved_meals (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  daily boolean NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meal_logs_user_recent_idx ON meal_logs (user_id, saved_meal_id, created_at) WHERE deleted_at IS NULL AND NOT daily;

ALTER TABLE food_entries ADD COLUMN meal_log_id uuid REFERENCES meal_logs (id) ON DELETE SET NULL;

CREATE INDEX food_entries_meal_log_idx ON food_entries (meal_log_id) WHERE meal_log_id IS NOT NULL;
