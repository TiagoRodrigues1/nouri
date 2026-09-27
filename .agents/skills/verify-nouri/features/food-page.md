# Food page

Open `/food` and fill `input[aria-label="Choose log date"]` with `2026-09-25`. With nothing logged, the `Meals` card reads `No foods logged`. Log the catalog apple at 08:15 (see [catalog-log.md](catalog-log.md)) and the manual `Verification oats` at 13:30 (see [manual-log.md](manual-log.md)); pick the time with `#food-time` before saving.

The `Intake` card shows 392 kcal and `1,608 kcal left` against the 2,000 kcal default target, with protein, carbs, and fat against their targets and each macro's share of energy. `Meals` groups the apple under `MORNING` and the oats under `MIDDAY`, each with its kcal subtotal. `Top foods` ranks the oats first at `311 kcal · 79%`. Choose the `Protein` tab and the list named `Top foods by protein` ranks the oats at `13 g`.

Log again always lands today at the current time. On a past day the button reads `Log Apple, flesh and skin, raw again today` (on today it ends in `again now`). Choose it: the toast reads `Food added to today's log.` and 2026-09-25 keeps its two entries. The page calls `POST /v1/food-entries/<id>/repeats`, and `GET /v1/days/<today>` shows the new apple with the same nutrients and Ciqual `catalogRef` as the original. Choose `Next day` until today, and delete that apple with its `Delete Apple, flesh and skin, raw` button; the API reports no entries for today.

Meals are grouped and timed in each entry's recorded `timeZone`, not the browser's. An entry logged through the API at 13:00 `Asia/Tokyo` shows `13:00` under `MIDDAY` in a browser running on Lisbon time.

`Top foods` merges entries that are the same food, not entries that share a name. Catalog entries match on their `catalogRef` provider and ID. Manual entries match when their names agree after trimming and ignoring case, and their nutrients per gram, millilitre, or serving agree. Two manual `Yogurt` entries of 100 g at 60 kcal and 100 g at 150 kcal rank as two rows, while 100 g at 60 kcal and 200 g at 120 kcal with the same macro ratios rank as one.
