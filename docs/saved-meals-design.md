# Saved meals

> Superseded in part by [meals-page-design.md](meals-page-design.md): meals are now built and managed on a Meals page from any food, and the Save as meal dialog is gone.

## Problem

Log again repeats one food, so a usual breakfast still takes one action per food. A saved meal keeps several foods and their amounts together and logs them in one action. The rules that protect a single entry still apply. The client never sends Ciqual nutrients, since a manual body that carries a Ciqual reference is rejected as forgery. An unknown nutrient stays `null`. A retry never logs the meal twice. A crash never leaves half a meal logged.

## Usage (caller's view)

On the Food page, each time-of-day group has a **Save as meal** button. It opens a dialog with the group's foods ticked, a suggested name (Breakfast, Lunch, Snack, Dinner), and an amount for each food. The dialog lists every food of the day, so a meal can include foods eaten at different times. The food dialog under **+ Log** has a **Saved meals** tab. Choose a meal, untick or re-amount foods for this time only, and **Log meal** records them at the dialog's time.

```http
POST /v1/saved-meals
Idempotency-Key: meal-1

{"name":"Usual breakfast","items":[{"entryId":"<oats entry>","amount":60},{"entryId":"<apple entry>","amount":150}]}
→ 201 {"id","revision":1,"name","items":[{"id","food":{name, quantity, nutrients, catalogRef}}]}

POST /v1/saved-meals/<id>/logs
Idempotency-Key: log-1

{"occurredAt":"…","timeZone":"Europe/Lisbon","items":[{"id":"<item>","amount":90}]}
→ 201 {"entries":[FoodEntry…]}

GET /v1/saved-meals → {"meals":[…]}          DELETE /v1/saved-meals/<id> with If-Match
```

```ts
save.mutate({ name, items: chosen.map(({ id, amount }) => ({ entryId: id, amount })) });
log.mutate({ meal, input: { occurredAt: occurredAt(date, time), timeZone, items: chosen } });
```

## Shape

```ts
// src/meals/contract.ts — shared by the server and the page
type MealFood = FoodEntry["food"];                        // a recorded food at its saved amount
type SavedMeal = { id; revision; name; items: Array<{ id: string; food: MealFood }> };
function scaleFood(food: MealFood, amount: number): MealFood;  // null stays null, rounded to 1/1000

// src/meals/meals.ts
function listMeals(db, userId): Promise<SavedMealList>;
function mutateMeal(db, userId, key, command: { kind: "create"; input } | { kind: "delete"; id; revision }): Promise<MealMutationResult>;
function logMeal(db, userId, key, id, input: MealLogInput): Promise<MealLogResult>;

// src/food/food.ts — still the only owner of food_entries rows
function recordedFoods(tx, userId, ids): Promise<Map<string, MealFood>>;
function insertFoods(tx, userId, when, foods: MealFood[]): Promise<FoodEntry[]>;  // also serves log again
```

A saved meal is a snapshot. Saving copies each chosen entry's recorded food on the server, scaled to the chosen amount. Logging scales each saved food to that time's amount and inserts every entry in one statement. The receipt and the entries commit in one transaction, and the receipt body holds `{entries}`, so a retry replays the same entries. `saved_meals.items` is one jsonb document because a meal is always read and written whole, like the supplement stack.

A saved meal cannot be edited. The page logs by item id, so the items it showed are the items logged. A meal deleted in the meantime returns 404. Logging needs no `If-Match` and has no stale-read race. An item id the meal lacks, or an amount whose scaled nutrients exceed the journal's limits, returns 400 and keeps no receipt.

| Module | Owns |
| --- | --- |
| `src/meals/contract.ts` | Wire schemas, the item limit, and `scaleFood` |
| `src/meals/meals.ts` | `saved_meals`, snapshots, and the log transaction |
| `src/food/food.ts` | Reading recorded foods and inserting copies of them |
| `frontend/src/lib/saved-meals.ts` | Form rows, the amounts to send, and the preview total (unit tested) |
| `frontend/src/meal-items.tsx` | The tick-and-amount list shared by saving and logging |
| `save-meal-dialog.tsx`, `saved-meals-tab.tsx` | The two entry points |

## Synthesis decision

Two candidates were compared. The base is a server-owned saved-meal resource that stores copied portions and has a dedicated log endpoint. The other stored the whole meal list as one document replaced by `PUT`, with a generic batch food create that the client fills. That shape lost on interface depth. The client would assemble every batch and send manual nutrients itself. Catalog items would be re-resolved when logged, which contradicts log again's snapshot rule. The server could not tell a meal from any other batch. The base also dropped the other candidate's meal editing: without it, logging needs no revision check and cannot race an edit. Two ideas were adopted from the other candidate: the receipt body holding an array of entries, and a single transaction for every insert.

## Tradeoffs accepted

- A meal cannot be renamed or re-amounted in place. Deleting it and saving it again replaces it. In exchange, logging never meets a changed meal. [Editing saved meals](saved-meal-editing-design.md) later lifted this while keeping logging race-free.
- Amounts adjusted while logging apply to that time only. The saved amounts stay the defaults.
- Logged entries do not link back to their meal. Each one edits and deletes like any other food, and there is no undo for the whole meal.
- Catalog foods scale linearly from the saved snapshot and keep their reference, as log again does. They are not recalculated from the current catalog.
- The unit of an item cannot change. Only its amount can.

## Alternatives considered

| Shape | What it hides | Why it lost |
| --- | --- | --- |
| Meal list document with `PUT` and batch food create | A third mutation shape | The client sends nutrients and composes batches, and catalog items drift from log again's snapshot rule |
| Meals holding entry ids that are repeated when logged | Copying on save | Deleting or editing the source day would break or silently change the meal |
| The client loops over log again with one key per food | Any new endpoint | Not atomic, so a retry after a partial failure duplicates foods, and there is no amount adjustment |

## Open questions and risks

- Should the Saved meals tab rank meals by how recently they were logged, or by the time of day in the picker? Today the newest saved meal comes first. Answered in [meal-logs-design.md](meal-logs-design.md).
- Is a whole-meal undo worth adding a nullable `meal_log_id` to `food_entries`? Answered in [meal-logs-design.md](meal-logs-design.md).
- Should editing a meal in place come later, with `If-Match` on logging if it does? It came later without `If-Match`; see [saved-meal-editing-design.md](saved-meal-editing-design.md).
