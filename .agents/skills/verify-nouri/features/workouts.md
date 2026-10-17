# Workout routines and live workouts

Choose the `Workouts` sidebar link. With no routines the page reads `No routines yet` with `Create a routine`, and the header has `Start empty workout`.

Create a routine. Fill `Routine name` with `Push day`, and use `Add exercise` to pick `Barbell Bench Press - Medium Grip` and `Standing Military Press` from the `Choose an exercise` picker (see [exercise-library.md](exercise-library.md) for its selectors). Each exercise card has a body figure of the muscles it works in place of a photo, `Chest · Barbell`, an `<exercise> options` menu with `Replace exercise` and `Remove exercise`, and a table named `<exercise> sets` whose rows hold a `<exercise> set N reps` field, prefilled `8-12`. Change set 1 to `5`, choose `Add set` (the new set copies the last target), and save with `Save routine`. The page returns to `/workouts` and toasts `Push day saved.`. The card reads `2 exercises · 7 sets`, with `Start Push day` and `Edit Push day`. A target such as `12-8` or `abc` marks the field invalid and keeps the routine unsaved.

Choose `Start Push day`. `/workouts/session` shows `Push day`, `Finish`, and a `Workout so far` strip of Time (counting), Volume, and Sets. Each set row has a PREVIOUS cell, `<exercise> set N weight in kg`, `<exercise> set N reps` with the target as its placeholder (`8–12`), a `<exercise> set N done` checkbox, and `Remove <exercise> set N`.

Before ticking any sets, choose `Finish`: the dialog says `No sets are ticked yet, so there is nothing to log.`, with `Keep going` and `Discard workout`. Choose `Keep going`.

Type `60` as set 1's weight and tick it: reps fill with `5`, the row turns green (`tr[data-done]`), and Volume reads `300 kg`. A decimal comma (`62,5`) is accepted. Reload: the ticks and values stay, and the clock keeps counting from the start.

While the workout is open, every other page shows a bar with `Push day`, the elapsed time, and `Resume`. On `/workouts`, `Start Push day` instead opens `A workout is in progress` with `Resume` and `Discard and start`.

Choose `Finish`. The dialog holds only `Duration (min)`, prefilled from the clock, and `Save workout`; unticked sets are left out. `Save workout` toasts `Push day saved.` and opens Overview on the start day. `GET /v1/overview/<day>` has one `strength` workout whose `strengthExercises` hold the ticked sets in order, consecutive equal sets merged into one row (`sets: 2`). Its exercises appear in Progress.

Start the routine again. PREVIOUS now reads each set from the last session (`60kg × 5`); choosing it copies the values. The weight placeholder is last time's weight, and ticking an empty row fills it from the placeholders. `Discard workout` asks `Discard this workout?` once a set is ticked, and discarding removes the resume bar.

Open the routine with `Edit Push day`, change it, and save; the revision moves on, and a workout in progress keeps the plan it started with. `Delete routine` removes the card and toasts that workouts logged from it stay.
