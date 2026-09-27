# Edit a food

Entry points: the pencil `Edit <food name>` button on each row of the Food page's Meals card and of the My Day timeline. Cover both.

Create a catalog food (for example 150 g of raw apple) and a manual food on `2026-09-25`. On the Food page, choose `Edit <catalog food>`. The dialog shows the name read-only and `#edit-food-amount`; change it to `100` and save. The row's grams and kcal change, the totals follow, and `GET /v1/days/2026-09-25` shows the recalculated nutrients and `revision` 2.

On My Day, choose `Edit <manual food>`. Change `#edit-food-amount` and check the nutrient fields scale with it. Change the time with the `Time eaten` picker, clear `#edit-food-fatG`, and save. The row moves to the new time on the same day, and the day readback shows `fatG: null` and a `null` fat total.

For a conflict, open the edit dialog, change the same entry through the API with its current revision, then save in the dialog. The toast reads `Revision conflict`, the dialog stays open and restarts from the API's change, and the row shows it. Saving again from there succeeds. If the entry is deleted through the API instead, saving closes the dialog with `Food entry not found`.
