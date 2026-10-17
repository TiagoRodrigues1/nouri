-- The saved meal list reads every active log of a person: the ones made by hand to rank meals, and daily fills too
-- for the last day each meal is on. One index serves both, so the hand-made-only one goes.
DROP INDEX meal_logs_user_recent_idx;

CREATE INDEX meal_logs_user_active_idx ON meal_logs (user_id, saved_meal_id, created_at) WHERE deleted_at IS NULL;
