# Workout progress

Log strength workouts on several earlier days through `+ Log` > `Exercise` with Activity `Strength training`: a `Squat` at 3 × 8 and 55, 60, then 65 kg, and on the 65 kg day a second `Squat` row of 1 × 12 at 50 kg. Add a `Push-up` with no weight to two of them. Spell one Squat in lowercase.

Open `+ Log` > `Exercise` on a later day, switch to `Strength training`, and type ` SQUAT` as the exercise name. Below the name, `Last time, <day>: 3 × 8 · 65 kg, 1 × 12 · 50 kg` appears. A name never logged shows nothing. `Repeat` fills Sets, Reps per set, and Weight from the first row. On a date between two sessions, the line names the earlier one, never a later one.

Choose the `Progress` sidebar link. The `Exercise` picker shows the most recently done exercise. The summary line counts the sessions and names the best. `Top weight per session (kg)` charts one point per session; pointing at the chart or focusing it and pressing the arrow keys shows a tooltip with the day and its sets. The table lists the sessions newest first, with the two-row day as one session whose Volume sums both rows. Pick `Push-up`: the chart switches to `Total reps per session`, Top weight reads `Bodyweight`, and Volume reads `—`. Choosing `Previous day` past the earliest session shows the empty state. A day's `Open <day> in Overview` link opens that day.

In Overview, the exercise names in the Workouts tile link to `/progress?date=<day>&exercise=<key>`.

Read `GET /v1/workouts/exercises` and assert one `squat` exercise with its sessions oldest first, `topWeightKg`, `totalReps`, and `volumeKg`, and `null` top weight and volume for Push-up. Delete one strength workout from Overview and confirm its session drops out of the readback and the page.
