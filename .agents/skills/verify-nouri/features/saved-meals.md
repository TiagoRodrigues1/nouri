# Saved meals

Open `/food` and fill `input[aria-label="Choose log date"]` with `2026-09-25`. Log the catalog apple at 150 g and a manual `Oats` of 80 g at 300 kcal, both at 08:15, so both sit under `MORNING` (see [catalog-log.md](catalog-log.md) and [manual-log.md](manual-log.md)).

Choose `Save morning foods as a meal` in the `MORNING` header. The `Save as meal` dialog names the meal `Breakfast` and lists every food of the day, with the morning ones ticked. Set `Amount of Oats in g` to `60`. The oats row previews 225 kcal and the summary reads `2 of 2 foods` and `306 kcal`. Choose `Save meal`. The toast reads `Breakfast saved.`, and `GET /v1/saved-meals` returns the meal with oats at 60 g and the apple with its Ciqual `catalogRef`. Deleting the oats entry from the day afterwards leaves the meal unchanged.

Choose `Next day`, then `+ Log`, `Food`, and the `Saved meals` tab. The list named `Saved meals` shows `Breakfast` with `2 foods · 306 kcal`. Choose it, and set `Amount of Apple, flesh and skin, raw in g` to `100`. Unticking a food with `Include <name>` leaves it out of this log only. Choose `Log meal`. The toast reads `Breakfast added to your log.` and the dialog closes. The page calls `POST /v1/saved-meals/<id>/logs` once. `GET /v1/days/2026-09-26` shows oats at 60 g (225 kcal) and apple at 100 g (54 kcal), both at the picked time, with 279 kcal total. The saved meal still holds the apple at 150 g.

Choose `Delete saved meal Breakfast` in the tab. The tab reads `No saved meals yet.`, `GET /v1/saved-meals` returns `{"meals":[]}`, and the foods already logged from the meal remain.
