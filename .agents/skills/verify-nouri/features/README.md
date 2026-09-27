# Nouri verification map

This index is the maintained list of Nouri's user paths. Read the relevant file before verification. The web page at `/` is the primary interface; the authenticated API is a second view for stored effects.

## Baseline preconditions

- Launch a fresh run with `control-nouri launch RUN_ID`, source its `/tmp/nouri-verify-RUN_ID/env`, and run `control-nouri doctor RUN_ID`.
- Open `$NOURI_BASE_URL/` in the run's own `"$CONTROL" browser "$RUN_ID"` session.
- Start from an empty database and open the journal page.
- Keep screenshots and redacted snapshots in `/tmp/nouri-verification-evidence/$RUN_ID`.

## Proof rules

- Capture the page before the action and after the visible result. For mutations, capture the relevant day, Overview, or dashboard GET as an independent readback.
- Cover every entry point listed for the selected behavior, or report which one was skipped and why.
- A screenshot of a success notice alone is insufficient; show the food row or changed totals.
- Never save the API token, authorization header, or browser storage in evidence.

## Features

- [Search foods](search.md): Ciqual search results, no-match state, attribution.
- [Log a catalog food](catalog-log.md): search, select, set grams, save and read back.
- [Log a manual food](manual-log.md): manual tab, nutrition fields, save and read back.
- [Browse dates and delete](dates-delete.md): date input and arrows, daily totals, remove a row.
- [Edit a food](edit.md): pencil on Food page and timeline rows, catalog amount, manual fields and time, revision conflict.
- [Log water](water.md): preset and custom amounts, daily total, remove a drink.
- [Overview](overview.md): sidebar link, category tabs, measurements, workouts, sleep, progress photos, deletion. The Supplements tab is covered in [Supplements](supplements.md).
- [Customize My Day cards](cards.md): show, hide, reorder, save, reload, and restore defaults.
- [Food page](food-page.md): intake against targets, meals by time of day, top foods, log again, delete.
- [Supplements](supplements.md): sidebar dialog edits the list from today, My Day checklist and Overview `Take` buttons tick and untick intakes, earlier days keep their list.
- [Targets](targets.md): sidebar dialog, save, pages reflect new targets, earlier days keep old ones.
