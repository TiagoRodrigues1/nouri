# Log again

Open `/` and fill `input[aria-label="Choose log date"]` with `2026-09-25`. Log the catalog apple at 08:15 (see [catalog-log.md](catalog-log.md)) and the manual `Verification oats` at 13:30 (see [manual-log.md](manual-log.md)); pick the time with `#food-time` before saving. The timeline shows each under its hour, and the Daily totals gauges read 392 kcal against the 2,000 kcal default target.

Log again always lands today at the current time. On a past day, each timeline row's button reads `Log Apple, flesh and skin, raw again today` (on today it ends in `again now`). Choose it: the toast reads `Food added to today's log.` and 2026-09-25 keeps its two entries. The page calls `POST /v1/food-entries/<id>/repeats`, and `GET /v1/days/<today>` shows the new apple with the same nutrients and Ciqual `catalogRef` as the original. Choose `Next day` until today, and delete that apple with its `Delete Apple, flesh and skin, raw` button; the API reports no entries for today.

The timeline places and times entries in each entry's recorded `timeZone`, not the browser's. An entry logged through the API at 13:00 `Asia/Tokyo` shows `13:00` in a browser running on Lisbon time.

`/food` is gone; opening it lands on `/`.
