# Workout progress

Log strength workouts on several earlier days through `Ctrl+K` > `Start workout` > `Log a past activity` with Activity `Strength training`, creating `Squat` (Quads, Barbell) from the picker the first time: a `Squat` at 3 × 8 and 55, 60, then 65 kg, and on the 65 kg day a second `Squat` row of 1 × 12 at 50 kg. Add the catalog's `Pushups` with no weight to two of them.

Open `Ctrl+K` > `Start workout` > `Log a past activity` on a later day, switch to `Strength training`, and choose `Add exercise`. The `Choose an exercise` picker lists a `Recent` group of the exercises done on or before that date, most recently done first, above the whole library. Choose `Squat` there. Its card shows `Last time, <day>: 3 × 8 · 65 kg, 1 × 12 · 50 kg` below the exercise button. An exercise never logged shows nothing. `Repeat` fills Sets, Reps per set, and Weight from the first row. On a date between two sessions, the line names the earlier one, never a later one. The exercise picker itself is covered in [exercise-library.md](exercise-library.md).

Choose the `Progress` sidebar link. The `Exercise` picker shows the most recently done exercise. The summary line counts the sessions and names the best. `Top weight per session (kg)` charts one point per session; pointing at the chart or focusing it and pressing the arrow keys shows a tooltip with the day and its sets. The table lists the sessions newest first, with the two-row day as one session whose Volume sums both rows. Pick `Pushups`: the chart switches to `Total reps per session`, Top weight reads `Bodyweight`, and Volume reads `—`. Choosing `Previous day` past the earliest session shows the empty state. A day's `Open <day> in Overview` link opens that day.

In Overview, the exercise names in the Workouts tile link to `/progress?date=<day>&exercise=<key>`.

Read `GET /v1/workouts/exercises` and assert one `squat` exercise with its sessions oldest first, `topWeightKg`, `totalReps`, and `volumeKg`, and `null` top weight and volume for `pushups`. Delete one strength workout from Overview and confirm its session drops out of the readback and the page.
