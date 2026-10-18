# Meals

Meals live on the **Meals** page (`/meals`, `Meals` in the main navigation). The command palette only logs them.

## Build a meal from scratch

Open `Meals`. The empty page reads `No meals yet`. Choose `Create a meal`. Fill `Meal name` with `Usual breakfast`. In the `Add food` panel choose the `Search` tab, search `oats`, and tick the first `Food search results` row (`Select <name>`); it joins `Foods in this meal` at 100 g. Set its `Amount of <name> in g` field to `60`. Choose the `Manual` tab, fill `#food-name` `Skyr`, `#manual-kcal` `110`, `#manual-protein` `18`, `#manual-carbs` `7`, `#manual-fat` `0.3`, `#manual-amount` `100`, and choose `Add to meal`; the form clears. The list named `Foods in this meal` shows both foods, each with an `Amount of <name> in g` field and a `Remove <name>` button, and `Meal totals` reads 337 kcal. Choose `Save meal`. The toast reads `Usual breakfast saved.` and the page returns to `/meals`, where the list named `Meals` shows a card with 337 kcal, its macros, and `Oat, raw 60 g · Skyr 100 g`. `GET /v1/saved-meals` returns the oats with its Ciqual `catalogRef` (resolved on the server) and Skyr with `catalogRef: null`. Building a meal logs nothing.

## Edit and delete

Choose `Edit <name>` (or the meal's name). Change an amount, remove a food, add another from `Recent` (tick its row; unticking it removes it again), and choose `Save meal`; the page sends `PATCH /v1/saved-meals/<id>` once with `If-Match`. `Delete meal` removes it at once, with no confirmation, and returns to the list with the toast `<name> deleted. Foods already logged from it stay.`; foods already logged from it stay.

## Save a day's foods as a meal

On Today with foods logged, choose `Save foods as a meal` in the Timeline header. The editor opens at `/meals/new?date=<day>` reading `Starting from the foods of <long date>` (for example `Friday, October 2, 2026`) with every food of the day in `Foods in this meal`.

## Log a meal

Press `Ctrl+K` and choose `Log food`. The `Saved meals` group lists meals, filtered as you type, each with its food count and kcal. Enter on a meal calls `POST /v1/saved-meals/<id>/logs` once at its saved amounts; the toast reads `<name> added to your log.` and `GET /v1/days/<date>` shows the foods at the palette's time. Change an amount afterwards with `Edit <name>` on the timeline.

## Undo a logged meal, and recency

The log toast has an `Undo` button; it calls `DELETE /v1/meal-logs/<id>` once, toasts `<name> removed from your log.`, and the foods leave the timeline. On the Timeline, a logged meal's foods sit under a purple row with the meal's name and a `Remove <name> and its foods` button (title `Remove meal`) that does the same, for daily fills too. `GET /v1/days/<date>` shows each such entry's `mealLogId` and the day's `mealLogs`. The palette's `Saved meals` group lists the most recently logged meal first; after its log is removed, it drops back to where its save date puts it. Daily fills do not move a meal ahead in this ordering.

A meal card shows `Last logged today`, `Last logged yesterday`, or a short date such as `Last logged Sep 28`; a meal with no remaining logged foods has no line. `GET /v1/saved-meals` returns this day as `lastLogged`, including daily fills. Log a meal, return to Meals, and compare the card with that readback. Remove its last kept log and confirm the line disappears.

## Daily meals

Tick `Log on these days at` in the editor before saving, or tick the `Log <name> every day` checkbox on a meal's card (which sends the meal back once as `PATCH /v1/saved-meals/<id>` with only `daily` changed; the toast reads `<name> will be logged every day at 08:00.`). Today's timeline then shows the meal's foods at that time, `GET /v1/days/<today>` returns them as ordinary entries in the totals, and `GET /v1/days/<tomorrow>` stays empty until it becomes today. The card's label turns `Every day at` purple, and the palette's `Saved meals` row adds `every day at 08:00`. Due days are filled when the day, Review, recent-foods, or saved-meals endpoints are read, including MCP `get_day`. To check the saved-meals trigger alone, create a daily meal through the public API, then read `GET /v1/saved-meals` before opening a day. Its `lastLogged` becomes today, and the subsequent day read contains the meal's foods. Deleting a pre-filled food keeps it deleted; unticking toasts `<name> will no longer be logged every day.` and keeps the days already filled. `daily-meals.test.ts` covers missed days, which are filled on the next read.

Under the editor's checkbox, the `Days to log it on` group holds one toggle per weekday (`Mon` to `Sun`, shown as initials, chosen days purple); unpressing the last one is ignored. Unpress `Sat` and `Sun` and save: the card reads `Weekdays at`, its checkbox is named `Log <name> on weekdays`, the palette row adds `on weekdays at 08:00`, and `GET /v1/saved-meals` returns `daily.weekdays` `[1, 2, 3, 4, 5]`. Other sets read `Weekends` or the day names (`Mon, Wed, Fri`). On a day not chosen, `GET /v1/days/<today>` stays empty. A new time from the card's picker keeps the weekdays. Ticking the card's checkbox on a meal that is off turns it on for every day. When the card reads `Last logged today`, ticking opens a popover titled `<name> is already logged today` with `Today too` and `From tomorrow`. `From tomorrow` toasts `<name> will be logged every day at 08:00 from tomorrow.`, and `GET /v1/days/<today>` keeps only the foods already there. Pressing Escape leaves the meal off. In the editor, ticking `Log on these days at` for a meal that is off shows a `Start tomorrow` checkbox. It starts ticked for a meal logged today or one made from today's foods, and the hint then reads `from tomorrow`. `daily-meal-from-tomorrow.test.ts` covers the cursor and retries. `daily-meal-weekdays.test.ts` covers skipped days in a missed week.

Enable daily logging again and change its time directly on the card with the time picker. The new time saves when the picker closes; its `Now` action saves immediately. Confirm the new `daily.time` in `GET /v1/saved-meals`.
