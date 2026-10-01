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
src/review/review.ts     getReview(db, userId, to): the window, empty days, recorded counts
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
- The food range read fetches nutrient values for the seven days and uses the same completeness rule as the day read. It transfers one row per food rather than aggregate SQL rows.

## Not in this version

Averages, trends against targets, charts, and coaching suggestions. Water and supplements are not in the timeline.
