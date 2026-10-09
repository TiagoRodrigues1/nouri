# Meals

Meals live on the **Meals** page (`/meals`, `Meals` in the main navigation). The food dialog only logs them.

## Build a meal from scratch

Open `Meals`. The empty page reads `No meals yet`. Choose `Create a meal`. Fill `Meal name` with `Usual breakfast`. In the `Add food` panel choose the `Search` tab, search `oats`, choose the first `Food search results` button, set `#search-amount` to `60`, and choose `Add to meal`. Choose the `Manual` tab, fill `#food-name` `Skyr`, `#manual-grams` `170`, `#manual-kcal` `110`, `#manual-protein` `18`, `#manual-carbs` `7`, `#manual-fat` `0.3`, and choose `Add to meal`; the form clears. The list named `Foods in this meal` shows both foods, each with an `Amount of <name> in g` field and a `Remove <name>` button, and `Meal totals` reads 337 kcal. Choose `Save meal`. The toast reads `Usual breakfast saved.` and the page returns to `/meals`, where the list named `Meals` shows a card with 337 kcal, its macros, and `Oat, raw 60 g · Skyr 170 g`. `GET /v1/saved-meals` returns the oats with its Ciqual `catalogRef` (resolved on the server) and Skyr with `catalogRef: null`. Building a meal logs nothing.

## Edit and delete

Choose `Edit` (or the meal's name). Change an amount, remove a food, add another from `Recent`, and choose `Save meal`; the page sends `PATCH /v1/saved-meals/<id>` once with `If-Match`. `Delete meal` removes it and returns to the list; foods already logged from it stay.

## Save a day's foods as a meal

On Today with foods logged, choose `Save foods as a meal` in the Timeline header. The editor opens at `/meals/new?date=<day>` reading `Starting from the foods of <day>` with every food of the day in `Foods in this meal`.

## Log a meal

Choose `+ Log`, `Food`, and the `Meals` tab. Choose the meal in the list named `Meals`. Unticking `Include <name>` or changing `Amount of <name> in g` applies to this time only. `Log meal` calls `POST /v1/saved-meals/<id>/logs` once; the toast reads `<name> added to your log.` and `GET /v1/days/<date>` shows the foods at the dialog's time. `Manage meals` goes to `/meals`.

## Daily meals

Tick `Log every day at` in the editor before saving, or tick `Log <name> every day` on a meal's card (which sends the meal back once as `PATCH /v1/saved-meals/<id>` with only `daily` changed; the toast reads `<name> will be logged every day at 08:00.`). Today's timeline then shows the meal's foods at that time, `GET /v1/days/<today>` returns them as ordinary entries in the totals, and `GET /v1/days/<tomorrow>` stays empty until it becomes today. The card's label turns `Every day at` purple, and the food dialog's Meals list adds `every day at 08:00`. Deleting a pre-filled food keeps it deleted; unticking keeps the days already filled. `daily-meals.test.ts` covers missed days, which are filled on the next read.
