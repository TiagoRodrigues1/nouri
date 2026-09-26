# Log a manual food

Connect and choose `2026-09-25` with `input[aria-label="Choose log date"]`. Choose `Log a food` and the `Add manually` tab. Fill `#food-name` with `Verification oats`, `#manual-grams` with `80`, `#manual-kcal` with `311`, `#manual-protein` with `13`, `#manual-carbs` with `53`, and `#manual-fat` with `5`. Capture a screenshot, then press Enter in `#manual-fat`. Check the `Logged foods` row and summary, reload to check persistence, and read `GET /v1/days/2026-09-25` to confirm the stored amount and nutrients.
