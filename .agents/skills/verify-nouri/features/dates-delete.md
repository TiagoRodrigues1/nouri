# Browse dates and delete

Create an entry on `2026-09-25`. Fill `input[aria-label="Choose log date"]` with `2026-09-24` to check the prior day. Use the `Previous day` and `Next day` buttons to navigate; the selected date and entries must change together. Return to `2026-09-25`, capture the food row, then choose its `Delete <food name>` button. The row disappears and the summary updates. Read `GET /v1/days/2026-09-25` before and after deletion to confirm persistence.
