# Customize My Day cards

On `/`, choose `Customize cards`. The dialog lists eight cards. Daily totals, Water, Supplements, Energy mix, and Activity are shown by default; Fasting, Largest food, and Meals start hidden. Check `Fasting`, choose `Move Fasting up` once, then `Save`. The My Day page shows the added card before Activity. It reads `Eating window` until at least one logged food time has passed today, then `Fasting`. A food logged for later today still leaves the card on `Eating window`. On earlier dates, the card always reads `Eating window`. Reload and check the order persists. Read `GET /v1/dashboard` and confirm `cards` is `["totals", "water", "supplements", "mix", "fasting", "activity"]`.

Open `Customize cards` again, choose `Restore defaults`, then `Save`. The added card disappears and `GET /v1/dashboard` returns `["totals", "water", "supplements", "mix", "activity"]`. Capture the dialog before saving and the page after each save.
