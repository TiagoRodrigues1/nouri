# Seven-day review

## Problem

Nouri records food, workouts, sleep, and weight, but Today and Overview show one day at a time. Reviewing a week meant stepping through seven dates. The first version is factual: it shows what was recorded and adds no suggestions.

## Usage (caller's view)

The sidebar has a Review link. It shows the last seven days. The header arrows move the window a week at a time, and the date picker chooses the week's last day and shades the seven days. The window is in the URL (`/review?to=2026-09-23`), so opening a day and pressing Back returns to the same week. Each day is a row with calories, protein, workout time, sleep, and weight, and two links that open that day in Today or Overview. A footer row counts the days with records for each column, and the header line says how many of the seven days have any record.

```ts
const review = await getReview(token, "2026-09-30");
// review.from === "2026-09-24", review.days.length === 7, oldest first
// review.days[0].food.kcal === null  // nothing logged: the cell stays blank
// review.recordedDays.any === 5      // "Records on 5 of 7 days"
```

`GET /v1/review/{date}` returns that shape. A metric is `null` when the day has no record of that kind. Food totals are also `null` when a logged food lacks the value, and `food.entryCount` tells the two cases apart, so the page shows those days as incomplete instead of blank. Weight is the last weight recorded that day and does not carry forward the way Overview's latest weight does. Sleep counts toward the day it ends on, as elsewhere.

## Shape

```
src/review/contract.ts   reviewSchema, reviewDays
src/review/review.ts     getReview(db, userId, to): the window, empty days, recorded counts, target comparison
src/effective-dated.ts   getDatedHistory(db, kind, userId, to)    the targets in force on each day
src/food/food.ts         getFoodRange(db, userId, from, to)       per-day count, kcal, protein
src/workouts/workouts.ts getWorkoutRange(db, userId, from, to)    per-day count, minutes
src/sleep/sleep.ts       getSleepRange(db, userId, from, to)      per-day sessions, minutes
src/measurements/...     getWeightRange(db, userId, from, to)     per-day last weight
frontend/src/review.tsx  the /review page
```

Each record module owns its range read, as it owns its day read, so the null rules stay in one place per kind. `getReview` runs the four reads in parallel, fills the seven days, and counts them, the same way `getOverview` composes day reads. Each range read is one query on the existing `(user_id, local_date)` index.

The day links include `?date=` in their Today and Overview URLs. Those pages use that date and remember it for ordinary sidebar navigation, so a copied link opens the same day. Review keeps its week in the `to` search parameter; on `/review` the header controls change that parameter instead.

## Synthesis decision

Candidate A was a server-side window: one endpoint whose module aggregates each kind over the range. Candidate B was a client-side fan-out: the page reads `/v1/days` and `/v1/overview` for each of the seven dates and derives the rows. B needs no API change but makes fourteen requests, loads entries and photo metadata it discards, and moves the null and incomplete rules into the page. It would also have to filter measurements again to avoid showing Overview's carried-forward weight as a day's value. A hides all of that behind one call and one schema, so it is the base.

The first sketch also took B's idea of reusing the shell's selected date as the window's end. Driving the page showed that was wrong: opening a day moves the selected date, so returning to Review showed a different week. Review now keeps its week in the URL and reuses only the shell's header controls.

## Tradeoffs accepted

- A day without workouts is blank, so a rest day and an unlogged day look the same. Nouri has no record of rest days.
- The sidebar Review link always opens the last seven days. Back returns to an earlier week, but the sidebar does not remember it.
- `+ Log` on the Review page logs to the visible window's last day. Each dialog states that date before saving.
- On narrow screens the table scrolls sideways to reach Weight and the day links.
- A day with only part of its food logged counts as complete when every logged food has calories and protein. The count says "complete records", not "fully logged days".
- The 10% calorie band is a fixed convention, not a setting.
- The food range read fetches nutrient values for the seven days and uses the same completeness rule as the day read. It transfers one row per food rather than aggregate SQL rows.

## Targets comparison

The first version left the person to judge the numbers. Review now compares calories and protein with the person's targets, and counts the days with complete food records.

```ts
review.recordedDays.food === 4             // food logged on 4 days
review.nutrition.completeDays === 3        // "Complete food records on 3 of 7 days"
review.days[1].targets                     // { kcal: 1800, proteinG: 120 }, the targets in force that day
review.nutrition.kcal                      // { average: 2100, averageTarget: 2066.67, daysOnTarget: 2 }
review.nutrition.proteinG.daysOnTarget     // days that reached the protein target
```

A complete food day has food logged and known calorie and protein totals. Nouri has no "I finished logging" marker, so this is the strictest rule the data supports: a day with an `Incomplete` total would always read as under target. A day with one snack logged still counts as complete. Only complete days are averaged and counted.

Each day carries the targets in force that day. `getDatedHistory` in `src/effective-dated.ts` reads every change saved up to `to` in one query, latest first, so a target changed mid-week judges each day by its own target. The weekly target is the mean of the complete days' targets.

The rules live in `getReview`, not the page: calories are on target within `calorieTolerance` (10%) of the target in either direction, and protein is on target once it reaches the target. The page shows each complete day's difference from its target under the total, and two cards with the average, the target, and the on-target count.

### Synthesis decision

Candidate A extended `/v1/review` with per-day targets and the weekly comparison. Candidate B kept the API and had the page read `/v1/targets/{date}`: either seven more requests, or only the window's last day, which misjudges the days before a mid-week change. B would also put the completeness and on-target rules in the page, where a native client would have to copy them, which the targets design set out to avoid. A is the base. From B it keeps the idea that the arithmetic per day (the difference) is plain enough to do in the page; only the rules that need a threshold stay on the server.

## Not in this version

Trends across weeks, charts, carbohydrate and fat comparisons, and coaching suggestions. Water and supplements are not in the timeline.
