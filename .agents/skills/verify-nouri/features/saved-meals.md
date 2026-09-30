# Saved meals

Open `/` and fill `input[aria-label="Choose log date"]` with `2026-09-25`. Log the catalog apple at 150 g and a manual `Oats` of 80 g at 300 kcal, both at 08:15 (see [catalog-log.md](catalog-log.md) and [manual-log.md](manual-log.md)).

Choose `Save foods as a meal` in the Timeline header. The `Save as meal` dialog lists every food of the day, all ticked, with an empty `Meal name`. Fill `Breakfast` and set `Amount of Oats in g` to `60`. The oats row previews 225 kcal and the summary reads `2 of 2 foods` and `306 kcal`. Choose `Save meal`. The toast reads `Breakfast saved.`, and `GET /v1/saved-meals` returns the meal with oats at 60 g and the apple with its Ciqual `catalogRef`. Deleting the oats entry from the day afterwards leaves the meal unchanged.

Choose `Next day`, then `+ Log`, `Food`, and the `Saved meals` tab. The list named `Saved meals` shows `Breakfast` with `2 foods · 306 kcal`. Choose it, and set `Amount of Apple, flesh and skin, raw in g` to `100`. Unticking a food with `Include <name>` leaves it out of this log only. Choose `Log meal`. The toast reads `Breakfast added to your log.` and the dialog closes. The page calls `POST /v1/saved-meals/<id>/logs` once. `GET /v1/days/2026-09-26` shows oats at 60 g (225 kcal) and apple at 100 g (54 kcal), both at the picked time, with 279 kcal total. The saved meal still holds the apple at 150 g.

Choose `Edit saved meal Breakfast`. The log form gives way to a form with `Meal name` set to `Breakfast` and the list named `Foods kept in Breakfast`. Rename it to `Light breakfast`, set `Amount of Oats in g` to `40`, untick `Include Apple, flesh and skin, raw`, and choose `Save changes`. The toast reads `Light breakfast saved.`, and the page calls `PATCH /v1/saved-meals/<id>` once with `If-Match: "1"`. The list shows `Light breakfast` with `1 food · 150 kcal`, and the log form offers oats at 40 g. `GET /v1/saved-meals` returns revision 2 with only the oats item, under the same item id as before.

Choose `Delete saved meal Light breakfast` in the tab. The tab reads `No saved meals yet.`, `GET /v1/saved-meals` returns `{"meals":[]}`, and the foods already logged from the meal remain.
