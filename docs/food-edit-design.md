# Edit a food entry

## Problem

The API has accepted `PATCH /v1/food-entries/{id}` since the first slice, but the web app can only add, log again, and delete. A wrong amount or time means deleting the row and logging it again. The edit must keep the entry's nutrient snapshot rules: the server calculates catalog nutrients, and a manual body carrying a Ciqual reference is rejected as forgery. A missing nutrient stays `null`, not zero. Retries reuse one idempotency key, and a stale revision must not overwrite a newer one.

## Usage (caller's view)

Each food row on the Food page and in the My Day timeline gets an `Edit <food name>` button next to delete. The shell holds which entry is being edited and renders one dialog for it.

```tsx
<Button aria-label={`Edit ${name}`} onClick={() => onEdit(entry)}><Pencil size={15} /></Button>

const [editingId, setEditingId] = useState<string | null>(null);
<EditFoodDialog token={token} date={date} entryId={editingId} onClose={() => setEditingId(null)} />
```

The dialog shows the time eaten and the amount for every entry. A catalog entry shows its name read-only and the server recalculates its nutrients for the new amount. A manual entry also shows its name and nutrients. Changing the amount scales the nutrients from the last values typed, and an empty nutrient is sent as unknown. Saving sends:

```http
PATCH /v1/food-entries/<id>
Idempotency-Key: <one key per distinct edit, reused on retry>
If-Match: "<entry.revision>"

{"occurredAt":"…","timeZone":"…","food":{"kind":"catalog","ref":{…},"quantity":{"amount":120,"unit":"g"}}}
```

## Shape

```ts
// frontend/src/lib/api.ts
function updateFood(token: string, key: string, entry: FoodEntry, input: FoodSubmission): Promise<FoodEntry>;

// frontend/src/lib/food-edit.ts — pure, unit tested
type NutrientKey = keyof FoodEntry["food"]["nutrients"];
type NutrientText = Record<NutrientKey, string>;
type FoodDraft = { time: string; amount: string; name: string; nutrients: NutrientText };

function draftFor(entry: FoodEntry): FoodDraft;
function scaleNutrients(nutrients: NutrientText, from: number, to: number): NutrientText;
// Keeps the recorded instant and zone when the time is unchanged; otherwise reads the new time
// on the entry's local date in the browser's zone, so an edit never moves the entry to another day.
function editedSubmission(entry: FoodEntry, draft: FoodDraft): FoodSubmission;

// frontend/src/edit-food-dialog.tsx
function EditFoodDialog(props: { token: string; date: string; entryId: string | null; onClose: () => void }): JSX.Element;
```

`EditFoodDialog` holds only the id and reads the entry from the day query, so it always edits what is saved now. It owns the mutation and the key; the form inside it is keyed by id and revision and owns the draft. It uses the shared idempotent write hook. The request signature includes the entry id and revision, so a retry of the same edit reuses its key and a new revision gets a new one. On 404 or 409 the hook refreshes the day and the toast explains why. After a revision conflict the refreshed entry has a new revision, so the form restarts from the saved values and the next save gets a new key rather than replaying the stale receipt. An entry deleted meanwhile drops out of the day, and the dialog closes. A missing catalog food discards its receipt, so the form stays as typed and can be saved again. The hook is renamed from `useIdempotentCreate` to `useIdempotentWrite` because it now serves edits too. Its 404/409 refresh matches the delete hook.

| Module | Owns |
| --- | --- |
| `frontend/src/lib/food-edit.ts` | Which body an entry's edit sends, time and zone preservation, nutrient scaling |
| `frontend/src/edit-food-dialog.tsx` | The edit form, its mutation, and the success and conflict behavior |
| `frontend/src/views.tsx` | Which entry id is being edited; its routes pass `onEditFood` to the pages as a prop |
| `food-page.tsx`, `my-day.tsx` | The edit button on each row |

The server does not change. `food-edit.ts` is unit tested in Node, so it imports the backend contract and `lib/time.ts` rather than the API client. `timeZone` and `occurredAt` moved to `lib/time.ts` for that reason, and `api.ts` re-exports them.

## Synthesis decision

I compared three shapes. A dedicated dialog over the existing full-replacement `PATCH` is the base. A server-side portion edit, which rescales the saved snapshot like `repeats` does, would keep catalog entries from older Ciqual releases editable. But it adds a second way to change a catalog amount and a new receipt fingerprint, and manual fixes still need full replacement. Only one catalog version exists today, and version mapping belongs in `catalogFood` when a second one ships. An edit mode on `LogFoodDialog` lost on interface depth. That dialog is built around search and tabs with an uncontrolled manual form, so each field would need an edit branch and more props.

## Tradeoffs accepted

- The day of an entry cannot be changed; only its time. That keeps edits from silently moving rows off the page being viewed.
- Editing the time re-records the entry in the browser's zone, keeping the same wall-clock date. An unchanged time keeps the original instant and zone.
- A catalog entry cannot become manual, because the server rejects manual bodies carrying a Ciqual reference.
- Saving an unchanged form still sends an edit and bumps the revision.

## Alternatives considered

| Shape | What it hides | Why it lost |
| --- | --- | --- |
| Server portion edit rescaling the saved snapshot | Catalog version drift | A second amount-edit path for a problem that does not exist yet |
| Edit mode on `LogFoodDialog` | One dialog component | The search-first dialog grows a branch per field |

## Open questions and risks

- When Ciqual ships a new release, editing an entry logged against the old one returns "Catalog food not found" until `catalogFood` maps old versions.
