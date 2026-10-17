-- A daily meal logs itself only on the weekdays it names, ISO numbered (1 Monday to 7 Sunday). Meals already daily
-- keep every day. The weekdays are set and cleared with the time.
ALTER TABLE saved_meals ADD COLUMN daily_weekdays smallint[];

UPDATE saved_meals SET daily_weekdays = '{1,2,3,4,5,6,7}' WHERE daily_time IS NOT NULL;

ALTER TABLE saved_meals ADD CONSTRAINT saved_meals_daily_weekdays_check CHECK (
  (daily_time IS NULL) = (daily_weekdays IS NULL)
  AND (daily_weekdays IS NULL OR (cardinality(daily_weekdays) BETWEEN 1 AND 7 AND daily_weekdays <@ '{1,2,3,4,5,6,7}'))
);
