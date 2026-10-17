# Meal logs

## Problem

Logging a saved meal inserts several food entries that do not remember they came from a meal. A wrong tap in the palette, or a daily breakfast filled on a day it was skipped, has to be removed one food at a time. [saved-meals-design.md](saved-meals-design.md) left this open: "Is a whole-meal undo worth adding a nullable `meal_log_id` to `food_entries`?"

Saved meals are listed newest-saved first. The palette shows the first five, so a meal eaten every week but saved months ago sinks below meals made once and never used. The same doc asked whether to rank them by how recently they were logged.

## Usage (caller's view)

- Logging a meal from the palette toasts "Breakfast added to your log." with an **Undo** button. Undo removes every food that log added.
- On the Timeline, the foods of one meal log sit under a row naming the meal, with a **Remove meal** button. It works the same for a meal logged by hand and for a daily meal filled automatically.
- The palette, the Meals page, and MCP `list_saved_meals` list meals most recently logged first. A meal never logged ranks by when it was saved. A daily meal's automatic fills do not count as using it, and an undone log stops counting.

```http
POST /v1/saved-meals/<id>/logs → 201 {"entries":[{…, "mealLogId":"<log>"}]}

GET /v1/days/2026-10-17 → {…, "food":{"entries":[{…, "mealLogId":"<log>"}], …}, "mealLogs":[{"id":"<log>","name":"Breakfast"}]}

DELETE /v1/meal-logs/<log>
Idempotency-Key: undo-1
→ 204, or 404 when the log is unknown or already removed
```

```ts
// After logging, the toast's Undo.
undo.mutate({ id: entries[0].mealLogId, name: meal.name });

// The Timeline's meal row.
<Button aria-label={`Remove ${log.name}`} onClick={() => onRemoveMeal(log)} />
```

## Shape

```sql
-- One logging of a saved meal: by hand, or one day's daily fill. The name is the meal's when it was logged.
CREATE TABLE meal_logs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  saved_meal_id uuid NOT NULL REFERENCES saved_meals (id) ON DELETE CASCADE,
  name text NOT NULL,
  daily boolean NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE food_entries ADD COLUMN meal_log_id uuid REFERENCES meal_logs (id) ON DELETE SET NULL;
```

```ts
// src/food/contract.ts
entrySchema = recordBaseSchema.extend({ food, mealLogId: z.uuid().nullable().default(null) });  // old receipts replay as null

// src/food/food.ts: still the only writer of food_entries
function insertFoods(tx, userId, when, foods, mealLogId?: string): Promise<FoodEntry[]>;
function deleteMealFoods(tx, userId, mealLogId): Promise<void>;   // soft-deletes the log's active entries

// src/meals/contract.ts
mealLogRefSchema = z.object({ id: z.uuid(), name: z.string() });

// src/meals/meals.ts
function logMeal(…): Promise<MealLogResult>;          // now writes a meal_logs row and tags its entries
function fillDailyMeals(db, userId): Promise<void>;   // one daily meal_logs row per filled day
function undoMealLog(db, userId, key, id): Promise<{ outcome: "deleted" | "missing" | "key-reuse" }>;
function mealLogsFor(db, userId, ids: string[]): Promise<MealLogRef[]>;
function listMeals(db, userId): Promise<SavedMealList>;   // ordered by greatest(last kept manual log, created_at)

// src/days/days.ts
getDay → { ...food, water, supplements, mealLogs: mealLogsFor(ids of the day's entries) }

// frontend/src/lib/use-saved-meals.ts
function useUndoMealLog(): Mutation<MealLogRef>;
function useLogMeal(onLogged): …;   // its success toast carries Undo
```

The meal log is a row of its own rather than a stamp on each entry. It holds the name once, so the Timeline still says "Breakfast" after the meal is renamed or deleted. It also gives recency a single source: the latest `created_at` among a meal's logs that were made by hand and not undone. Recency is computed on read, as recent foods are, so nothing has to be kept in sync and an undone log stops counting without extra work.

A log has no date or time of its own. The Timeline reads them from the log's entries, and the day lists only the logs its entries name. An entry moved to another time stays in its log, and removing the meal removes it too.

Undo takes no `If-Match`. A log never changes after it is written, so nothing can go stale. Undo soft-deletes the log and every active entry it tagged in one transaction, including entries edited since. Entries already deleted one by one stay deleted. Undoing a log that is already removed returns 404, and a retry with the same key replays 204.

| Module | Owns |
| --- | --- |
| `src/meals/meals.ts` | `meal_logs`, undo, recency ordering, daily fills writing logs |
| `src/food/food.ts` | Tagging inserted entries and soft-deleting a log's entries |
| `src/days/days.ts` | Attaching the day's meal logs |
| `frontend/src/lib/use-saved-meals.ts` | Undo mutation, the toast action |
| `frontend/src/my-day.tsx` | The meal row in the Timeline |

## Synthesis decision

I compared three whole shapes. External architect runners were not available in this session.

- **A: a `meal_logs` row, with entries pointing at it** (above).
- **B: stamps without a table.** `food_entries` gains `meal_log_id` and `meal_name`, and `saved_meals` gains `last_logged_at`, set when logging. There is one table fewer, but the name is copied onto every entry. `last_logged_at` is maintained state that undo has to roll back, and there is no single row for a daily fill to be undone as.
- **C: client-side only.** The toast's Undo deletes the returned entries through a batch delete, and the page keeps its own recency in `localStorage`. Undo vanishes with the toast, daily fills cannot be undone, the ordering differs per device, and MCP never sees it.

A is the base. It adds one noun, one endpoint, and one nullable column, and recency is derived rather than stored.

## Tradeoffs accepted

- Removing a meal also removes its entries that were edited or moved since. The meal row shows which foods it covers.
- Foods ticked together in the palette and logged in one batch are not a meal log. Only saved meals make one.
- Daily fills never change a meal's rank. A daily meal is logged for the person, so they rarely need to find it.
- The ranking applies to the Meals page too, so cards move after logging.
- Meals logged before this change have no logs. They rank by when they were saved until next logged, and their entries cannot be removed as a whole.

## Alternatives considered

| Shape | What it hides | Why it lost |
| --- | --- | --- |
| Stamps on entries plus `last_logged_at` | A table | The name is duplicated, recency needs maintaining, and undo has to roll it back |
| Toast-only undo with client recency | Any schema change | Undo is gone once the toast is, daily fills cannot be undone, and the order is per device |
| Ranking by time of day | Nothing new to store | It does not answer "the meal I use most lately", and meals have no time except daily ones |

## Open questions and risks

- Should the Meals page show "Last logged …" on each card now that the server knows it?
