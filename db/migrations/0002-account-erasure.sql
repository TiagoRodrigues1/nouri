-- Every record belongs to a users row, and deleting the row erases the person's records with it. NOT VALID skips
-- checking rows written before accounts existed, which may belong to an API_USER_ID never linked to a Clerk user.
ALTER TABLE food_entries ADD CONSTRAINT food_entries_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE mutation_receipts ADD CONSTRAINT mutation_receipts_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE saved_meals ADD CONSTRAINT saved_meals_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE water_entries ADD CONSTRAINT water_entries_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE dashboard_layouts ADD CONSTRAINT dashboard_layouts_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE user_targets ADD CONSTRAINT user_targets_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE body_measurements ADD CONSTRAINT body_measurements_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE workouts ADD CONSTRAINT workouts_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE sleep_sessions ADD CONSTRAINT sleep_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE daily_activity ADD CONSTRAINT daily_activity_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE daily_heart_rate ADD CONSTRAINT daily_heart_rate_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE progress_photos ADD CONSTRAINT progress_photos_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE supplement_stacks ADD CONSTRAINT supplement_stacks_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE supplement_intakes ADD CONSTRAINT supplement_intakes_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE wearable_connections ADD CONSTRAINT wearable_connections_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;
ALTER TABLE wearable_oauth_states ADD CONSTRAINT wearable_oauth_states_user_fk FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE NOT VALID;

-- Clerk users whose account was erased. A session token outlives the deletion by up to a minute, and a request
-- carrying one must not create a fresh account. The retention sweep removes each row a day later.
CREATE TABLE erased_users (
  clerk_user_id text PRIMARY KEY,
  erased_at timestamptz NOT NULL DEFAULT now()
);

-- The retention sweep deletes retry receipts by age.
CREATE INDEX mutation_receipts_created_idx ON mutation_receipts (created_at);
