# Targets

Choose `Targets` in the sidebar under YOUR DATA. The dialog shows the defaults: `Energy (kcal)` 2000, `Water (ml)` 2000, `Sleep (h)` 8, and an empty `Goal weight (kg)`. Fill energy 1800, water 2500, sleep 7.5, and goal weight 72.5, then choose `Save targets`. On `/`, the Energy gauge reads `Energy · 1,800` and the water card reads `2,500 ml goal`. On `/overview`, the Nutrition section shows `1,800 kcal target`, Sleep shows `7 h 30 min goal`, and Weight shows `Goal 72.5 kg`.

Targets apply from today. Choose `Previous day`: the Overview returns to `2,000 kcal target` with no weight goal. Read `GET /v1/targets/<today>` (`effectiveFrom` is today) and `GET /v1/targets/<yesterday>` (`effectiveFrom` is `null`, default targets).

A failed targets read hides only the comparisons. With `GET /v1/targets/<date>` failing (for example a Playwright `page.route` returning 503), `/food` still shows the Intake totals, Meals, and Top foods, and the Intake card reads `Targets could not load: …` with `Try again`. `/overview` still shows every section with no target bars, and that message appears once, above the sections. On `/`, the message takes the cards' place; the timeline stays. Once the endpoint recovers, `Try again` brings back `2,000 kcal target`.
