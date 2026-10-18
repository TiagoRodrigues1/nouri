# Command palette

Entry points: `Ctrl+K` (or `Cmd+K`) on any page, and the sidebar's `+ Log` button (the phone top bar's `+ Log` at 680px or narrower). Pressing `Ctrl+K` again closes it. The palette floats near the top of the page without dimming it. At 680px or narrower it is a sheet from the bottom over a dimmed page; see Phone below.

The search is a combobox, so reach it with `getByRole("combobox")`. On the phone root, its accessible name keeps the desktop prompt while the placeholder changes. Items are `option`s named by their text. Each step after the root shows a `Back` arrow and chips in the header (`Food`, then the chosen food's name); an earlier chip goes back to its step. `Backspace` in an empty search, or `Escape`, goes back one step. `Escape` at the root closes the palette. Form steps (amount, manual food, barcode scan, measurement value) show only the chips above the form.

Root: the `Log` group (`Log food`, `Add water`, `Log measurement`, `Start workout`, `Log sleep`), `Go to` (`Today`, `Meals`, `Workouts`, `Overview`, `Progress`, `Review`), and `Settings` (`Targets`, `Supplements`, `Wearables`, which open their dialogs). Typing filters these. `Log sleep` opens the sleep dialog.

Quick log: at the root, `weight 82.4`, `82,4 kg weight`, `body fat 18.5%`, `waist 84 cm`, `500 water`, or `water 330ml` adds a `Quick log` item (`Log weight 82.4 kg`, `Add 500 ml of water`). Enter saves it at the current time on the page's date, closes the palette, and shows `Weight saved.` or `Water saved.`. Out-of-range values (`weight 5`, `water 9000`) offer no quick log.

Food: choose `Log food`. The list shows `Recent` foods (filtered as you type, the typed words marked in blue, each with its amount and kcal), `Saved meals`, `Foods` (Nouri's foods and Ciqual, searched once typing pauses; a barcode looks the product up), and `More` (`Add a food manually`, `Scan a barcode`). The highlight follows the first item until the arrow keys move it. The footer reads `Logging to today at <time>` (or the chosen date) with the time picker `#palette-time`.

- `Enter` on a food opens its amount step: `#palette-amount` (selected, at the last or default amount), the time, a nutrient preview, and `Also logging:` chips for foods already ticked. `Enter` logs this food with every ticked one (`Log N foods · X kcal`); `Ctrl+Enter` (`Add another`) keeps it ticked and returns to an empty food search.
- `Shift+Enter`, or the row's tick box (a `checkbox` named `Tick <name>`), ticks the highlighted food at its default amount without leaving the search.
- With foods ticked and an empty search, the first item is `Log N foods` under `Selected`, with their names and total kcal; `Enter` logs them in one `POST /v1/food-entries/batches`, closes the palette, and toasts `N foods added to your log.`
- `Enter` on a saved meal logs it at its saved amounts (`POST /v1/saved-meals/<id>/logs`, toast `<name> added to your log.`). The palette stays open if foods are ticked.
- `Add a food manually` shows the manual form (see [manual-log.md](manual-log.md)). Its `Add to selection` ticks the food and returns to the search, where `Log 1 food` logs it.
- A barcode Nouri does not know shows `No product with this barcode yet.` and an `Add this product from its label` item (see [community-foods.md](community-foods.md)).

Water: `Add water` lists `Glass` (250 ml), `Bottle` (500 ml), and `Carafe` (1000 ml). Typing a whole number of ml (1–5000) adds `Add <n> ml` first. `Enter` saves.

Measurement: `Log measurement` lists Weight, Height, Body fat, Waist. `Enter` opens `#palette-measurement` with the unit and the time; `Enter` saves (`<Name> saved.`).

Workout: `Start workout` lists the workout in progress (`Resume <title>`), the account's routines, `Start an empty workout`, and `Log a past activity` (opens the workout dialog, see [overview.md](overview.md)). Starting a routine opens `/workouts/session`. If a workout is already open, it is resumed with the toast `<title> is still open, so it was resumed.`

Check: log two foods (one through the amount step with `Ctrl+Enter`, one ticked with `Shift+Enter`), then read `GET /v1/days/<date>` and confirm both entries, their amounts, and the chosen time.

Phone (at 680px or narrower): opening focuses the sheet itself, leaving the search unfocused so no keyboard rises. The root shows six buttons (`Food`, `Water`, `Scan`, `Weight`, `Workout`, `Sleep`), a `Log again` row of recent foods, and the search at the bottom (placeholder `Search, or type “weight 82.4”`). Typing shows the same items and quick log as the desktop root. `Scan` opens the barcode scanner over the food step; `Weight` opens `#palette-measurement` directly; a `Log again` chip opens that food's amount step. In the food step, tapping a row ticks or unticks it, and its amount button (`Change the amount of <name>`) opens the amount step. Ticked foods are listed under `Selected` until a search, at their ticked amounts. The bar at the bottom holds `#palette-time` and `Log N foods · X kcal` (`Tap foods to tick them` while nothing is ticked). There are no key hints and no highlighted row. The sheet sits above the on-screen keyboard (`--keyboard-inset` on the dialog).

Phone check: at 390×844, add two foods with `Add a food manually`, confirm both under `Selected`, and log them from the bar. Reopen, tap a `Log again` chip, set 40, `Add another`, tick the other recent food and change its amount, then log both. `GET /v1/days/<date>` shows all four entries at those amounts.
