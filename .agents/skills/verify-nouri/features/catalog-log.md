# Log a catalog food

Connect and fill `input[aria-label="Choose log date"]` with `2026-09-25`. Choose `Log a food` in the sidebar, fill `#search-query` with `apple` and press Enter, and select `[aria-label="Food search results"] button:has-text("Apple, flesh and skin, raw")`. Fill `#catalog-grams` with `150`, capture a screenshot, and press Enter in `#catalog-grams`. The dialog closes, the `Logged foods` list shows the apple at 150 g and 81 kcal, and the summary increases by 81 kcal. Save an authenticated `GET /v1/days/2026-09-25` response and check its catalog reference and nutrients.
