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

## Water, supplements, weekly trends, and suggestions

Review now covers every kind the journal records, compares weeks, and makes a few modest suggestions from the last week.

```ts
review.days[0].water          // { entryCount: 2, totalMl: 1800 }; null total when no water was logged
review.days[0].supplements    // { intakeCount: 2, taken: 1, stackSize: 2 }: 1 of the day's 2 supplements taken
review.water                  // { average: 1200, averageTarget: 2000, daysOnTarget: 1 }, over days with water
review.sleep                  // the same comparison over recorded nights
review.supplements            // { stackDays: 7, fullDays: 2 }: days with a list, and days with all of it taken
review.weeks                  // whole weeks ending on `to`, oldest first, each the same summary as the range
review.suggestions[0]         // { kind: "protein", title: "Add a protein source to one meal", because: "Protein reached target on 2 of 5 days, …" }
```

### Shape

```
src/water/water.ts               getWaterRange(db, userId, from, to)        per-day count, ml
src/supplements/supplements.ts   getSupplementRange(db, userId, from, to)   per-day intakes, list items taken, list size
src/review/review.ts             summarize(days): ReviewPeriod              one rule set for the range and for each week
src/coaching/contract.ts         suggestionSchema, coachingPolicy           the thresholds, named
src/coaching/coaching.ts         coach(week): Suggestion[]                  pure rules over one week's summary
```

`Review` is a `ReviewPeriod` with its `days`, `weeks`, and `suggestions`. `summarize` is the only place that knows which days count as recorded, complete, or on target, so a week's numbers can never disagree with the range's. Weeks are whole seven-day runs ending on `to`. A 30-day range has four, and its two oldest days belong to no week. A day's supplements count only items on that day's list, as Today's checklist does. Intakes of items since removed still count as a record.

`coach` reads only the last week's summary and returns suggestions most important first. Each one says what it rests on. The rules follow the coaching flow in `backend-architecture.md`:

- Food needs `minEvidenceDays` (4) complete days. With fewer, the only food suggestion is to log every food for a few more days. Sparse logs block calorie and protein suggestions.
- Protein: reached target on fewer than half of the complete days.
- Calories: the average falls outside `calorieTolerance` of the average target.
- Water: the target was reached on fewer than half of at least 4 days with water.
- Sleep: at least 4 nights recorded and an average 30 minutes or more under target. Missing nights block any claim about sleep.
- Supplements: the full list was taken on fewer than half of at least 4 days with a list.

No suggestion proposes a new target. That is still an open product decision.

### Synthesis decision

For trends, candidate A extended the review with a per-week summary built from the same days. Candidate B added `GET /v1/trends` with weekly SQL aggregates. B would restate the completeness and on-target rules in SQL, and the page would join two responses with different null rules. A computing weeks in the page was rejected for the reason the targets comparison gives: a native client or the MCP server would have to copy the rules. A is the base. B's useful idea was a summary with no tie to a range. That became `ReviewPeriod`, which the range and its weeks share.

For suggestions, candidate A is a pure function over a week's summary, recomputed on every read. Candidate B is the persisted design in `backend-architecture.md`: `suggestion_runs`, evidence hashes, a job worker, and accept or dismiss responses. B exists for model output, which costs money, varies between runs, and needs an audit trail. Deterministic rules over current records are cheap and give the same answer each time, so persisting them would only add staleness to manage. A is the base. B returns when a model phrases or ranks suggestions. From B it keeps the evidence on every suggestion (`because`) and the named policy thresholds.

### Tradeoffs accepted

- Weekly trends need a range of two weeks or more. The default 7-day view shows a hint instead of fetching earlier weeks.
- Days before the oldest whole week are left out of the trends.
- Suggestions come from the last week of the range, whatever its length, so a 90-day view suggests from its final week.
- A day with a supplement list and no app use counts as a day the list was missed.
- Suggestions are not saved, cannot be dismissed, and change as soon as the records do.

## Not in this version

Carbohydrate and fat comparisons, workout suggestions, accepting or dismissing suggestions, and model-written suggestions.
