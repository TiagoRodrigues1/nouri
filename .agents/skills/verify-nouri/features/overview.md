# Overview

Choose the `Overview` sidebar link and check the `Overview categories` tabs: All, Nutrition, Sports, Measurements, Sleep, and Supplements. On an empty day, each section shows dashes and empty states; Supplements says `No supplements on your list for this day.`

Choose `Log measurement` and save a Height of `180` and a Weight of `81.5`. The Weight tile reads `81.5 kg` and the BMI tile reads `25.2`, labeled Overweight. Choose `Log workout` and save a 45-minute Run with `8.2` km and `520` kcal. The Activity tile reads `45 min`, `520 kcal`, and `8.2 km`. Choose `Log sleep` with the default 23:00 and 07:00 times, and enter Light 230, Deep 90, REM 110, and Awake 20. Time asleep reads `8 h 0 min`, and the stage bar lists four rows.

Choose `+ Log`, then `Exercise`, and switch Activity to `Strength training`. Distance disappears. Enter a duration, then add a Squat with 3 sets, 8 reps per set, and 60 kg. Add a Push-up with 3 sets and 12 reps, leaving weight empty. Save and check both exercises in the Sports workout row and `GET /v1/overview/<today>` under `sports.entries[].strengthExercises`; `distanceM` must be `null`.

Set a small PNG on the hidden `Choose a progress photo` input. A thumbnail named `Open photo from <date>` appears. Opening it shows the image in a dialog.

Read `GET /v1/overview/<today>` and assert these values: `sports.entryCount` 2, the run has `distanceM` 8200, the strength workout has `distanceM: null` and two exercises, `measurements.bmi` is 25.2, `sleep.totalMinutes` is 480 with stages, and one `photos` item has `contentType: image/png`. Delete the run through `Delete run at …` and the photo through `Delete photo`. Read the overview again and confirm that `sports.entryCount` is 1, the strength workout remains, and `photos` is empty. Delete the strength workout and confirm `sports.entryCount` is 0. The `Sleep` tab alone should show only the Sleep section heading.
