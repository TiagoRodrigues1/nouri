# Edit a food

Entry point: the pencil `Edit <food name>` button on each row of the My Day timeline.

Create a catalog food (for example 150 g of raw apple) and a manual food on `2026-09-25`. On `/`, choose `Edit <catalog food>` in the timeline. The dialog shows the name read-only and `#edit-food-amount`; change it to `100` and save. The row's grams and kcal change, the totals follow, and `GET /v1/days/2026-09-25` shows the recalculated nutrients and `revision` 2.

On My Day, choose `Edit <manual food>`. A manual food's name is editable in `#edit-food-name`. Change `#edit-food-amount` (labelled `Amount in grams`, `Amount in millilitres`, or `Number of servings` by unit) and check `#edit-food-kcal` and the other nutrient fields scale with it. Change the time with the `Time eaten` picker (`#edit-food-time`, not the log dialog's `#food-time`), clear `#edit-food-fatG`, and choose `Save changes`. The row moves to the new time on the same day, and the day readback shows `fatG: null` and a `null` fat total.

For a conflict, open the edit dialog, change the same entry through the API with its current revision, then save in the dialog. The toast reads `Revision conflict`, the dialog stays open and restarts from the API's change, and the row shows it. Saving again from there succeeds. If the entry is deleted through the API instead, saving closes the dialog with `Food entry not found`.
