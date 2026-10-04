# Recent foods

## Problem

Most foods a person logs are foods they have logged before. Log again already repeats an entry, but only from the day it was logged, only today at the current time, and only at the same amount. The Log Food dialog should offer recently logged foods directly. Picking one, adjusting the amount, and adding it should record it on the dialog's day and time.

The rules that protect log again and saved meals still apply. A repeated food copies its recorded snapshot rather than re-reading the catalog, so entries from an older Ciqual release keep working. The client never sends nutrients for a Ciqual food, because a manual body carrying a Ciqual reference is rejected as forgery. An unknown nutrient stays `null`. A retry never logs twice.

## Usage (caller's view)

The food dialog under **+ Log** opens on a new **Recent** tab, placed before **Search foods**, **Saved meals** and **Add manually**. It lists up to 20 distinct foods, most recently eaten first, each with the amount last logged and its nutrients. Choosing one shows an amount field in the food's own unit, filled with the last amount, plus a live nutrient preview. **Add to log** records the food at the dialog's date and time.

```http
GET /v1/foods/recent
→ 200 {"foods":[{"entryId":"<latest entry>","lastEaten":"2026-10-02","food":{name, quantity, nutrients, catalogRef}}]}

POST /v1/food-entries/<entryId>/repeats
Idempotency-Key: <one per distinct request, reused on retry>

{"occurredAt":"…","timeZone":"Europe/Lisbon","amount":150}
→ 201 FoodEntry
```

```tsx
<TabsContent value="recent">
  <RecentFoodsTab date={date} time={time} onLogged={() => onOpenChange(false)} />
</TabsContent>

const log = useLogRecent(onLogged);
log.mutate({ recent, input: { occurredAt: occurredAt(date, time), timeZone, amount } });
```

Log again sends no `amount` and keeps working unchanged.

## Shape

```ts
// src/food/contract.ts
const recordedFoodSchema: { name; quantity; nutrients; catalogRef };    // replaces meals' mealFoodSchema
type RecordedFood = z.infer<typeof recordedFoodSchema>;
const repeatInputSchema: { occurredAt; timeZone; amount?: positiveAmount.max(10_000) };
const recentFoodsSchema: { foods: Array<{ entryId: string; lastEaten: string; food: RecordedFood }> };
function scaleFood(food: RecordedFood, amount: number): RecordedFood;          // moved from meals
function scaledFood(food: RecordedFood, amount: number): RecordedFood | null;  // null when outside journal limits

// src/food/food.ts
type FoodMutationResult = … | { outcome: "catalog-missing" | "invalid-amount" };
function getRecentFoods(db, userId): Promise<RecentFoods>;

// frontend/src/lib/use-recent-foods.ts
function useRecentFoods(): UseQueryResult<RecentFood[]>;
function useLogRecent(onLogged: () => void): Mutation<{ recent: RecentFood; input: RepeatInput }>;

// frontend/src/recent-foods-tab.tsx
function RecentFoodsTab(props: { date: string; time: string; onLogged: () => void }): JSX.Element;
```

The server builds the recent list. It reads the person's latest 500 active entries in descending order of date, time eaten and time logged, using the existing `(user_id, local_date)` partial index, and keeps the first entry for each food. Two entries are the same food when they share a case-insensitive trimmed name, a catalog provider and id with any version, and a unit. The list stops at 20 foods. Deduplication is a pure function in `food.ts`. The list carries the source entry id, so logging reuses the repeat endpoint and its snapshot rule. A food from an older catalog release still logs from what was recorded.

A repeat accepts an optional `amount`. When present, the server scales the recorded food with the same `scaleFood` saved meals use. If the scaled nutrients fall outside the journal's limits, the result is `invalid-amount` (400). Scaling and that limit check move into `food/contract.ts`. Saved meals import them from there, so the rule has one owner. Omitting `amount` serializes the command exactly as before, so existing log again receipts keep their fingerprints.

`withReceipt` previously took a single `discard` outcome. Food writes now have two outcomes that must not be stored, `catalog-missing` and `invalid-amount`. The helper now discards every feature-specific outcome, and callers no longer pass one. That was already true at every call site.

| Module | Owns |
| --- | --- |
| `src/food/contract.ts` | Wire schemas, scaling, and the journal limit on a scaled food |
| `src/food/food.ts` | The recent list query and deduplication, and repeats with an amount |
| `src/journal/receipt.ts` | Which outcomes are stored |
| `frontend/src/lib/use-recent-foods.ts` | The recent query and the log mutation |
| `frontend/src/recent-foods-tab.tsx` | The list, amount field and preview |
| `frontend/src/log-food-dialog.tsx` | Tab order; Recent is the default |

`recent-foods` joins `queryRefresh.food`, so any food write refreshes the list.

## Synthesis decision

I compared three shapes side by side. External architect runners were not available in this session. The base is a server-built list plus an amount on the existing repeat. A client-assembled alternative would send a manual body with client-scaled nutrients, or a catalog body for Ciqual foods. It lost on depth. The client would branch on provenance, and Ciqual foods would be recalculated from the current catalog, which breaks the snapshot rule. Unversioned Ciqual references could not be logged at all. A third shape put recents into the search tab as catalog candidates, but manual and non-Ciqual foods have no per-100 g catalog candidate, so it could not represent them.

## Tradeoffs accepted

- The list only looks at the latest 500 entries. A food last eaten before that does not appear, and the person can search for it instead. In exchange, the read stays bounded without a new index or a maintained table.
- A food's identity uses its name, catalog id and unit, not its nutrients. Two manual "Granola" entries with different nutrients collapse into the most recent one.
- Recents are logged from the latest entry's snapshot, so editing that entry changes what the recent food logs. That matches what the person sees in the list.
- There is no way to hide a food from the list other than deleting its entries.

## Alternatives considered

| Shape | What it hides | Why it lost |
| --- | --- | --- |
| Client-scaled manual or catalog create | No API change | The client branches on provenance, and Ciqual foods drift from their snapshot |
| Recents inside the search results | One list | Manual and non-Ciqual foods cannot be shown as catalog candidates |
| A maintained `recent_foods` table | Fast reads at any history length | It must stay in sync with edits and deletes, and the bounded scan already suffices |

## Open questions and risks

- Should the dialog open on Recent even when the list is empty? It does, and the empty state points to Search foods.
