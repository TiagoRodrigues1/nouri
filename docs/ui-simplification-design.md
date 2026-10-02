# UI simplification

## Usage

Today is the journal: the timeline lists the day's foods with log again, edit, and delete on each row, and a save-as-meal button in its header. The cards beside it show totals, water, supplements, and the optional extras. Overview covers sports, body measurements, and sleep. Targets, Supplements, and Wearables open from the sidebar under Settings.

## What was repeated

- Food appeared on three pages: Today (timeline and gauges), Food (intake, meals, top foods), and Overview Nutrition (energy, macros, water, food count).
- Supplements had a Today card and an Overview section with the same checklist.
- A Wearables tile sat in both Overview Sports and Sleep, next to the sidebar dialog that manages the same connection.
- Every page header named itself three times: breadcrumb, eyebrow, and headline. The Food page added a subtitle and a second date bar.
- Sleep split one list across Time asleep, Sleep stages, and Sessions, so an empty day said "No sleep logged" three times. Sports split one list into an Activity tile and a Workouts tile.

## Decision

Each piece of data has one home. The Food page is removed, and `/food` redirects to `/`. Its two actions that existed nowhere else, log again and save as meal, move onto the timeline. Save as meal starts with every food of the day ticked, because the timeline has no time-of-day groups to preselect. Top foods and the Intake card's "kcal left" are dropped. The gauges show intake against targets, and the optional Largest food card covers the top-food question.

Overview loses its Nutrition and Supplements sections and both Wearables tiles. Imported workouts and nights still carry their device and an Imported badge. Sleep is one full-width tile with the total, goal bar, and sessions. When the night recorded stages, the stage bar and its labels appear inside that tile, so the layout keeps the same shape with or without data. Sports is one Workouts tile with the total time, a count, energy, and distance summary, and the list.

The shell header is the date and its controls. The sidebar keeps Today and Overview, then Settings.

## Alternative considered

Keeping three pages and trimming each would still show food totals twice and need a rule for which page owns the food list. Merging into two pages deleted five modules and left no data in two places.

## Not changed

The My Day card catalog is unchanged. `GET /v1/overview/{date}` later dropped `nutrition` and `supplements`: the page never showed them, the app had no other API clients, and reading them cost four queries per overview. Food, water, and supplements come from `GET /v1/days/{date}`.
