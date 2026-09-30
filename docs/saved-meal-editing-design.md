# Editing saved meals

## Problem

A saved meal could only be logged or deleted, so renaming one or changing its usual portions meant deleting it and saving it again from logged food. Editing in place has to keep what [saved meals](saved-meals-design.md) promised. Logging stays race-free without `If-Match`: the items the page showed are the items logged. The client still never sends nutrients. A retry never applies an edit twice. Nutrients also must not drift over repeated edits. Scaling rounds to the thousandth, so taking an 80 g food with 0.001 g of fat down to 10 g and back up leaves it with 0 g.

## Usage (caller's view)

In the food dialog's **Saved meals** tab, each meal has **Edit saved meal \<name\>** next to delete. It opens the meal in place of the log form, with its name and the same tick-and-amount list. Changing an amount sets the new usual portion. Unticking a food removes it from the meal. **Save changes** keeps the edit, and the log form then starts from the new amounts.

```http
PATCH /v1/saved-meals/<id>
Idempotency-Key: edit-1
If-Match: "1"

{"name":"Light breakfast","items":[{"id":"<oats item>","amount":40}]}
→ 200 {"id","revision":2,"name":"Light breakfast","items":[{"id":"<oats item>","food":{…quantity 40 g…}}]}
```

```ts
edit.mutate({ meal, input: { name: name.trim(), items: chosen } });   // chosen = chosenAmounts(rows)
```

## Shape

```ts
// src/meals/contract.ts
const itemAmountsSchema;                                   // [{id, amount}], 1–20, unique ids; shared by logging and editing
export const mealEditSchema = z.object({ name, items: itemAmountsSchema }).strict();
export type StoredMealItem = SavedMealItem & { basis?: MealFood };   // server-only; never on the wire

// src/meals/meals.ts
type MealCommand = … | { kind: "edit"; id; revision; input: MealEdit };
type MealMutationResult = { outcome: "created" | "updated"; entry: SavedMeal } | …;
function portion(item: StoredMealItem, amount: number): StoredMealItem | null;  // rescales from the basis
```

An edit is a full replacement of the editable fields: the name and the kept items with their amounts. Items keep their ids and their food, and only the amount changes, so an item never becomes another food. That is why logging still needs no `If-Match`. A log for a kept item sends its own amount and records the same food the page showed. A log that names a removed item returns 400 and records nothing, like any item the meal lacks. Adding foods is not an edit. It needs logged entries, and the Saved meals tab has none, so a new meal is saved from the Food page instead.

Each stored item keeps a hidden `basis`: the food exactly as it was recorded when the meal was saved. Editing and logging both scale from the basis, so any chain of edits gives the same nutrients as a single one. Meals saved before this change have no basis and scale from their current food. `meal(row)` drops the basis, so it never reaches the wire or a receipt.

The edit runs in `mutateMeal` under the same receipt as create and delete. It reads the row `FOR UPDATE`, answers `missing` or `stale` from the revision, and bumps the revision. An unknown item id or an amount past the journal's limits returns `invalid-item` and keeps no receipt.

| Module | Change |
| --- | --- |
| `src/meals/contract.ts` | `mealEditSchema`, shared item amounts, `StoredMealItem` |
| `src/meals/meals.ts` | The `edit` command, `portion`, and the basis on save |
| `src/app.ts` | `PATCH /v1/saved-meals/{id}` |
| `frontend/src/lib/use-saved-meals.ts`, `lib/api.ts` | `useEditMeal`, `updateSavedMeal` |
| `frontend/src/saved-meals-tab.tsx` | The edit button and `EditMealForm` |

## Synthesis decision

Two shapes were compared. The base edits the meal in place and keeps each item's id. The other copied on write: an edit saved a new meal and deleted the old one in one transaction, so the "never edited" rule held word for word and logging could not race. That shape lost on interface depth. Every edit changed the meal's id, so the page had to follow the new id, a log already open for the old meal returned 404, and the list order moved unless `created_at` was copied too. Keeping item ids stable gives the same guarantee to logging, and nobody has to follow an id. The copy-on-write candidate's idea of never scaling a scaled food became the hidden basis.

## Tradeoffs accepted

- We accept a `basis` stored next to each item's food, in exchange for edits that never lose precision. It is optional only for meals saved before editing existed.
- We accept that an edit cannot add foods, in exchange for keeping every edit within the Saved meals tab, with no day to pick entries from.
- We accept that a log racing an edit that removed one of its items fails with 400, in exchange for logging that needs no revision check. Reopening the meal shows its current foods.
- A saved edit bumps the revision even when nothing changed, like a food edit.

## Alternatives considered

| Shape | What it hides | Why it lost |
| --- | --- | --- |
| Copy on write, with a new meal id per edit | Revision checks on the meal row | Every caller has to follow an id that changes. An open log for the old id returns 404. |
| Separate rename and re-amount endpoints | Nothing more | Two mutation shapes for one form, and a half-applied edit if the second request fails |
| Rescaling the current food on each edit | The basis column | Rounding compounds, and 0.001 g taken down and back up becomes 0 |

## Open questions and risks

- Should a log that names a removed item return 409, so the tab refreshes on its own, rather than 400?
- Should editing also let the unit change, for instance from grams to servings? Today it cannot, like logging.

## Next implementation step

Add `mealEditSchema` and the `edit` command to `mutateMeal`, then the `PATCH` route and its integration test.
