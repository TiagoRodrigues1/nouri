# Targets

Choose `Targets` in the sidebar under SETTINGS. The dialog shows the defaults: `Energy (kcal)` 2000, `Water (ml)` 2000, `Sleep (h)` 8, and an empty `Goal weight (kg)`. Fill energy 1800, water 2500, sleep 7.5, and goal weight 72.5, then choose `Save targets`. On `/`, the Energy gauge reads `Energy · 1,800` and the water card reads `2,500 ml goal`. On `/overview`, Sleep shows `7 h 30 min goal`, and Weight shows `Goal 72.5 kg`.

Targets apply from today. Choose `Previous day`: the Overview returns to `8 h 0 min goal` with no weight goal. Read `GET /v1/targets/<today>` (`effectiveFrom` is today) and `GET /v1/targets/<yesterday>` (`effectiveFrom` is `null`, default targets).

A failed targets read hides only the comparisons. Intercept `GET /v1/targets/<date>` before an uncached page load (for example, route it to 503 and reload). A failed background refetch of a cached target does not show this error state. `/overview` still shows every section with no target bars, and `Targets could not load: …` with `Try again` appears once, above the sections. On `/`, the message takes the cards' place; the timeline stays. Once the endpoint recovers, `Try again` brings back the cards, with `Energy · 1,800` on the gauge after the save above.
