# Log again

Open `/` and choose `2026-09-25` with the `Choose log date` picker. Log the catalog apple at 08:15 (see [catalog-log.md](catalog-log.md)) and the manual `Verification oats` at 13:30 (see [manual-log.md](manual-log.md)); pick the time with `#palette-time` before saving. The timeline shows each under its hour, and the Daily totals Energy gauge reads `392` `kcal` (two elements, so its text is `392kcal`) under the label `Energy · 2,000`, the default target.

Log again always lands today at the current time. On a past day, each timeline row's button reads `Log Apple, flesh and skin, raw again today` (on today it ends in `again now`). Choose it: the toast reads `Food added to today's log.` and 2026-09-25 keeps its two entries. The page calls `POST /v1/food-entries/<id>/repeats`, and `GET /v1/days/<today>` shows the new apple with the same nutrients and Ciqual `catalogRef` as the original. Choose `Next day` until today, and delete that apple with its `Delete Apple, flesh and skin, raw` button; the API reports no entries for today.

The timeline places and times entries in each entry's recorded `timeZone`, not the browser's. An entry logged through the API at 13:00 `Asia/Tokyo` shows `13:00` in a browser running on Lisbon time.

`/food` is gone; opening it lands on `/`.
