# Manual food log slice

## Problem

The repository defines a journal and a day view but has no running API or database. The first slice must preserve each food entry's nutrient snapshot, accept retries of every write, and report daily calories and macros without treating missing values as zero. The existing `Journal` contract gives only creation an idempotency key, so edits and deletion need the same protection.

## Usage (caller's view)

The client sends a new key for each intended change and reuses that key when it retries the same request. An edit or deletion also supplies the revision returned by the last successful write.

```http
POST /v1/food-entries
Authorization: Bearer <token>
Idempotency-Key: create-01

{"occurredAt":"2026-09-24T12:30:00Z","timeZone":"Europe/Lisbon","food":{"name":"Oats","quantity":{"amount":80,"unit":"g"},"nutrients":{"kcal":311,"proteinG":13,"carbsG":53,"fatG":5}}}
```

```http
PATCH /v1/food-entries/<id>
Authorization: Bearer <token>
Idempotency-Key: edit-01
If-Match: "1"

{"occurredAt":"2026-09-24T12:30:00Z","timeZone":"Europe/Lisbon","food":{"name":"Oats","quantity":{"amount":80,"unit":"g"},"nutrients":{"kcal":300,"proteinG":13,"carbsG":53,"fatG":5}}}
```

```http
DELETE /v1/food-entries/<id>
Authorization: Bearer <token>
Idempotency-Key: delete-01
If-Match: "2"
```

`GET /v1/days/2026-09-24` returns `{date, food: {entries, entryCount, totals}}`. The totals have `kcal`, `proteinG`, `carbsG`, and `fatG`. An empty day has null totals. A nutrient total is null when any entry on that day lacks that nutrient. An explicit zero remains zero. The date groups each entry using the IANA time zone supplied when it was recorded.

## Shape

`food_entries` holds the current version of each entry, including a nutrient snapshot, `local_date`, revision, and deletion marker. `idempotency_keys` holds the request fingerprint and first HTTP result under a unique `(user_id, key)` constraint. A write transaction owns both rows. A retry with the same fingerprint returns the saved result before checking the current revision. Reusing a key for a different request fails. Receipts now expire after 30 days; [account-data-design.md](account-data-design.md) explains the rule.

```ts
type FoodInput = { occurredAt: string; timeZone: string; food: FoodPortion };
type FoodDatabase = import("drizzle-orm/postgres-js").PostgresJsDatabase<Record<string, never>>;

type FoodCommand =
  | { kind: "create"; input: FoodInput }
  | { kind: "edit"; id: string; revision: number; input: FoodInput }
  | { kind: "delete"; id: string; revision: number };

type FoodEntry = {
  id: string;
  revision: number;
  occurredAt: string;
  timeZone: string;
  localDate: string;
  food: Omit<FoodPortion, "catalogRef"> & { catalogRef: NonNullable<FoodPortion["catalogRef"]> | null };
};

type FoodDay = {
  date: string;
  food: {
    entries: FoodEntry[];
    entryCount: number;
    totals: {
      kcal: number | null;
      proteinG: number | null;
      carbsG: number | null;
      fatG: number | null;
    };
  };
};

type FoodMutationResult =
  | { outcome: "created" | "updated"; entry: FoodEntry }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" };

function mutateFood(db: FoodDatabase, userId: string, key: string, command: FoodCommand): Promise<FoodMutationResult> {
  throw new Error("not implemented");
}

function getFoodDay(db: FoodDatabase, userId: string, date: string): Promise<FoodDay> {
  throw new Error("not implemented");
}
```

`FoodDatabase` is the injected Drizzle connection used inside the server. The HTTP adapter parses JSON and headers into domain values, identifies the user, and maps outcomes to HTTP responses. The food module owns write transactions, revision checks, recorded-zone date membership, and day aggregation. The database schema stays private to that module. The API returns the food entries needed for later edits, while callers do not coordinate idempotency or totals themselves. This follows Model the Domain, Boundary Discipline, and Make Operations Idempotent from Poteto Mode.

| Module | Owns |
| --- | --- |
| `src/app.ts` | Authentication, retry-key checks, and route composition |
| `src/food/routes.ts` | Food routes, request parsing, and OpenAPI using the same request schemas |
| `src/journal/http.ts` | Shared mutation responses and retry/revision header validation |
| `src/food/food.ts` | Food commands, retry receipts, revisions, local dates, and totals |
| `src/db/schema.ts` and `db/schema.sql` | PostgreSQL tables and the reviewed schema SQL |
| `src/server.ts` | Process setup and database connection |

## Synthesis decision

I compared a mutable current-entry table with an append-only table of full entry revisions. The mutable table is the base because the first day view can read current rows directly and does not need a latest-revision query over historical writes. I kept the append-only candidate's single command operation, its insistence that the retry receipt and entry mutation commit together, and its rule that the day read derive totals from the same current entries it returns. Both candidates avoid transport types in the domain interface and pass-through service layers.

## Tradeoffs accepted

- We keep soft-deleted entries and idempotency receipts in exchange for stable retries and revision conflicts.
- We calculate day totals on each read in exchange for having no aggregate cache to reconcile after an edit or deletion.
- We store the local date calculated at write time in exchange for making an entry's original recording zone authoritative when the person travels.

## Alternatives considered

| Shape | What it hides | Why it lost |
| --- | --- | --- |
| Append-only entry revisions with latest-row day queries | Correction history and current-state reconstruction | Every day read must select the latest revision before filtering by date. That complexity buys history this milestone does not use. |
| Generic health-event table with JSON food payloads | Schema changes across record kinds | It makes nutrient and date rules part of every reader and weakens database constraints. |

## Open questions and risks

- Receipts expire after 30 days ([account-data-design.md](account-data-design.md)). A retry sent later creates a duplicate, so offline clients must drop older queued writes.
- Should a later day view re-group every entry in one chosen display zone? This slice follows the current architecture's recorded-zone rule.

## Next implementation step

Add the schema and one transaction-backed create path, then exercise it through the HTTP adapter against PostgreSQL before adding edits and deletion.

## Food route contracts

Food search, barcode lookup, recent foods, creation, edits, repeats, and deletion live in `src/food/routes.ts`. Search parameters and revision headers use the same schemas for runtime checks and OpenAPI documentation. The parent still authenticates and checks the retry key before route validation.

Routes retain manual request parsing. Existing callers may send valid JSON without a JSON Content-Type header, malformed bodies receive the existing JSON errors, and repeated search parameters use the first value. Switching directly to declarative request validation would change those behaviors. `tests/integration/food-routes.test.ts` checks compatibility and the published constraints through the application request interface.
