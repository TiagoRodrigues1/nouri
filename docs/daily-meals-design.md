# Daily meals

## Problem

Some meals are eaten every day, such as the same breakfast. Logging a saved meal is already one action, but it is still one action each day. A daily meal is a saved meal that logs itself: each day it is set for (every day, or chosen weekdays) already holds its foods, counted in the totals, and a skipped or changed food is deleted or edited like any other. The journal rules still apply. Entries are snapshots, so editing the meal later never rewrites a day that was already filled. A day is filled at most once per meal, so deleting a pre-filled food keeps it deleted. A day the person never opened still counts in the weekly review.

## Usage (caller's view)

On the Meals page, each meal's card and its editor have a daily checkbox and a time (see [meals-page-design.md](meals-page-design.md)). Ticking it fills today and every later day with the meal's foods at that time. The editor adds a row of weekday toggles, so a meal can log itself only Monday to Friday; the card's label names the days (**Every day at**, **Weekdays at**, **Mon, Wed, Fri at**). Unticking it stops future days, and days already filled keep their foods.

```http
POST /v1/saved-meals, PATCH /v1/saved-meals/<id>     the whole meal, as the editor saves it
{"name":"Breakfast","items":[…],"daily":{"time":"08:00","timeZone":"Europe/Lisbon","weekdays":[1,2,3,4,5]}}   → SavedMeal (daily: {time, timeZone, weekdays})
{"name":"Breakfast","items":[…],"daily":{"time":"08:00","timeZone":"Europe/Lisbon"}}   → weekdays [1..7], every day
{"name":"Breakfast","items":[…],"daily":null}                                          → SavedMeal (daily: null)

GET /v1/days/2026-10-08   → the meal's foods are ordinary entries at 08:00
```

```ts
const daily = useMealDaily();            // the card's toggle: the meal sent back with only `daily` changed
daily.set(meal, checked ? { time, timeZone } : null);
```

## Shape

```ts
// src/meals/contract.ts
mealDailySchema = { time: "HH:MM"; timeZone; weekdays: number[] }   // ISO 1 Monday to 7 Sunday, default all seven
savedMealSchema += { daily: MealDaily | null }
mealInputSchema += { daily: MealDaily | null }           // create and edit alike

// src/meals/meals.ts
dailyColumns(daily, stored)                               // the setting and, when turned on, the cursor
fillDailyMeals(db, userId): Promise<void>                 // logs every day due through today, once each
```

`saved_meals` gains `daily_time`, `daily_time_zone`, `daily_weekdays`, and `daily_filled_through`. The last is a cursor: the latest local day already filled. `fillDailyMeals` reads the daily meals whose cursor is before today in their own zone. It locks them, inserts the meal's foods for each day after the cursor through today that falls on one of its weekdays with `insertFoods`, and advances the cursor through today, all in one transaction. The cursor moves past days not chosen too, so it always means "decided through", and changing the weekdays never fills or skips a day already passed. A day the person never opened is filled with the next read, so the week stays complete.

Only turning a meal on moves the cursor: to the later of the cursor and yesterday, so today fills next and turning it off and on again the same day does not fill today twice. A meal already on keeps its cursor through any edit, including a new time or zone, so days not yet filled are never skipped. Turning it off clears the time and weekdays and keeps the cursor. The setting is part of the meal, written only by the meal's create and edit, so the card's toggle is an edit like any other: it bumps the revision and a stale one conflicts.

The reads that show logged foods (`GET /v1/days/<date>`, `GET /v1/review/<date>`, and `GET /v1/foods/recent`) call `fillDailyMeals` first, from one route list in `src/app.ts`, so no day, week, or recent food appears before its daily meals are on it. Other reads never write. The MCP server sits outside `/v1`, so its `get_day` tool calls it itself. The call stays at the route layer because the food reads live in `src/food/food.ts`, which `src/meals/meals.ts` already imports for `insertFoods`. The fill costs one indexed query when nothing is due.

| Module | Owns |
| --- | --- |
| `src/meals/contract.ts` | The daily schedule on the wire |
| `src/meals/meals.ts` | The setting, the cursor, and the fill transaction |
| `src/food/food.ts` | Inserting the copies (`insertFoods`, unchanged) |
| `frontend/src/meals/` | The **Log every day** controls on the card and in the editor |

## Weekdays

A meal can log itself on chosen weekdays only. Two shapes were compared inline.

- **A: a positive weekday set inside `daily`** (chosen). `weekdays` sits beside the time and zone it qualifies, stored as `daily_weekdays smallint[]`, set and cleared with the time. It defaults to every day, so callers and receipts from before it still mean what they did. The fill filters the days it walks; nothing else changes.
- **B: a separate skip list or recurrence rule** (a `skipWeekdays` field, a bitmask, or an RRULE string). A skip list reads backwards against the label people use ("Weekdays"), and a recurrence rule opens a wide interface for a seven-bit choice. Rejected.

## Synthesis decision

Three shapes were compared inline, since the arena runners were not available.

- **A: a fill cursor on the saved meal** (above). One function with no date argument brings the journal up to date. Every reader sees real entries, so totals, review, MCP, edits, and deletes need no changes.
- **B: a fill marker per meal and date, filled lazily for the date being read.** Each reader would have to pass its dates, and the review would have to fill its whole week. Browsing to a future date would fill it early, so an edit made today would miss it. It needs a row per day where A needs one date per meal.
- **C: virtual entries.** The day composes the meal's foods on the fly, with per-day skips and overrides. Every total, the review, MCP, and editing would have to know about entries that are not rows. Editing one would first have to make it real. Rejected as the widest leak.

A is the base. From B it takes the rule that a filled day is never filled again, kept as a cursor where B used markers.

## Tradeoffs accepted

- Filling happens on read, so a GET can write. A scheduler would need its own catch-up after downtime, which is this same function.
- Today fills as soon as the meal is turned on, even if that meal's time has passed or it was already logged by hand. Deleting the duplicate fixes it once.
- Edits to the meal apply from the next unfilled day. Today's foods, once filled, keep the amounts they had.
- Days are counted in the zone saved with the setting. After travel, ticking the box again updates the zone.
- Entries do not link back to their meal, as with logging a saved meal by hand.
- New weekdays apply from the next unfilled day. Adding today's weekday after today was passed over leaves today empty; log the meal by hand.
- Turning a meal off forgets its weekdays, as it forgets its time. Ticking the card again turns it on for every day.

## Open questions

- Should turning it on offer "from tomorrow" for when today's meal is already logged?
