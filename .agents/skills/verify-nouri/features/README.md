# Nouri verification map

This index is the maintained list of Nouri's user paths. Read the relevant file before verification. The web page at `/` is the primary interface; the authenticated API is a second view for stored effects.

## Baseline preconditions

- Launch a fresh run with `control-nouri launch RUN_ID`, source its `/tmp/nouri-verify-RUN_ID/env`, and run `control-nouri doctor RUN_ID`.
- Sign in by opening `$("$CONTROL" sign-in-url "$RUN_ID")` in the run's own `"$CONTROL" browser "$RUN_ID"` session. The page shows Clerk's sign-in until then.
- Start from an empty database and open the journal page.
- The header date is a shadcn date picker, not a text input. Choose the `Choose log date` button (`Choose the last day of the range` on Review), use `Go to the Previous Month` or `Go to the Next Month` if needed, then choose the day button, named like `Friday, September 25th, 2026`. To return to the current date, use the popover's `Today` button (match it exactly; the calendar's current day is named `Today, Friday, …`).
- The chosen date sticks for the browser tab. The sidebar `Today` link opens My Day on that remembered date, not on today, so check the `h1` reads `Today` before a recipe that says to stay on today's date.
- `+ Log` and `Ctrl+K` open the command palette, where every record is logged (see [command-palette.md](command-palette.md)). Its search is `getByRole("combobox")` and its choices are `option`s.
- Below 680px wide the sidebar becomes a top bar holding `+ Log`, the `Targets`, `Supplements`, `Wearables`, and theme (`Dark theme` or `Light theme`) icon buttons, and `Open user menu` (the account's name or address is hidden), and the page links move to a bottom tab bar. Names stay the same, so recipes that say "sidebar" work at phone width too.
- Keep screenshots and redacted snapshots in `/tmp/nouri-verification-evidence/$RUN_ID`.

## Proof rules

- Capture the page before the action and after the visible result. For mutations, capture the relevant day, Overview, or dashboard GET as an independent readback.
- Cover every entry point listed for the selected behavior, or report which one was skipped and why.
- A screenshot of a success notice alone is insufficient; show the food row or changed totals.
- Never save session tokens, sign-in URLs, authorization headers, cookies, or browser storage in evidence.

## Features

- [Account access](auth.md): signed-out page, test-user sign-in, sign-out, and protected API.
- [Data export](account-data.md): Download my data in the account menu, export file contents, withheld tokens.
- [Command palette](command-palette.md): `Ctrl+K` and `+ Log`, steps and Back, quick log for weight and water, foods by amount or ticked together, saved meals, water, measurements, starting a workout.
- [Search foods](search.md): Ciqual search results, no-match state, attribution.
- [Barcode lookup](barcode.md): typed or camera-scanned barcode in the palette's food search, live Open Food Facts product, serving default, check-digit and not-found states, logging and editing a scanned product.
- [Log a catalog food](catalog-log.md): search, select, set grams, save and read back.
- [Recent foods](recent-foods.md): Recent group in the palette's food search, one row per food, ticking foods from Recent and search into one selection, logging them together on the chosen day.
- [Log a manual food](manual-log.md): `Add a food manually` in the palette, label per 100 g or ml, amount eaten, save and read back.
- [Community foods](community-foods.md): `Add this product` after a barcode miss, `Share with other Nouri users` in the manual form, `User-added` results, review with `pnpm foods:review`.
- [Browse dates and delete](dates-delete.md): date picker and arrows, daily totals, remove a row.
- [Edit a food](edit.md): pencil on timeline rows, catalog amount, manual fields and time, revision conflict.
- [Log water](water.md): preset and custom amounts, daily total, remove a drink.
- [Overview](overview.md): sidebar link, category tabs, measurements, workouts, sleep, progress photos, deletion.
- [Exercise library](exercise-library.md): picker in the workout dialog, search and muscle and equipment filters, Recent group, create and delete a custom exercise.
- [Workout routines](workouts.md): Workouts sidebar page, routine editor with rep targets, live workout with PREVIOUS and done sets, resume bar, Finish into an ordinary strength workout, body map.
- [Workout progress](progress.md): last-time line and Repeat in the workout dialog, Progress sidebar page with exercise picker, chart, and sessions, links from Overview exercise names.
- [Review](review.md): sidebar link, range picker (7 days to 3 months), weight chart, review table with blank unrecorded days and recorded-day counts, day links into Today and Overview, Back, range arrows.
- [Wearable import](wearables.md): Wearables dialog in the sidebar, not-set-up state, fixture-backed Connect, imported sleep, workouts, and daily activity, repeat sync, disconnect, forged callback.
- [Customize My Day cards](cards.md): show, hide, reorder, save, reload, and restore defaults.
- [Log again](log-again.md): timeline log-again button on today and past days, recorded time zones, `/food` redirect.
- [Meals](saved-meals.md): Meals page in the main navigation, build a meal from search, recent, and manual foods, edit and delete it, start one from the Timeline's Save as meal, log it from the palette's `Saved meals` group, make it log itself every day.
- [Supplements](supplements.md): sidebar dialog edits the list from today, My Day checklist ticks and unticks intakes, earlier days keep their list.
- [Targets](targets.md): sidebar dialog, save, pages reflect new targets, earlier days keep old ones.
- [MCP server](mcp.md): `/mcp` refuses requests without an OAuth token and points clients at Clerk; the tools themselves need a registered OAuth client.
