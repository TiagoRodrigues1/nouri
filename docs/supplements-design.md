# Supplements

## Problem

People want to say which supplements they take, such as vitamin D, magnesium, or creatine, and then tick them off each day. That is two kinds of data. The *stack* is a setting that stays in force until it changes, like targets. An *intake* is a journal record of taking something at a time, like a glass of water. The code already has both precedents. Targets are effective-dated so that past days keep the settings they had. Food entries freeze a snapshot of what was logged, so a later catalog change never rewrites history. The supplements slice has to honor both rules. Stopping creatine today must not make last month look like you never took it. Changing a dose must not change what an earlier intake records.

## Usage (caller's view)

```http
PUT /v1/supplement-stack/2026-09-27
{ "supplements": [
  { "id": "5d1c…", "name": "Vitamin D3", "kind": "vitamin", "dose": { "amount": 2000, "unit": "IU" } },
  { "id": "a07e…", "name": "Creatine monohydrate", "kind": "creatine", "dose": { "amount": 5, "unit": "g" } } ] }
→ 200 { "effectiveFrom": "2026-09-27", "supplements": [ … ] }

POST /v1/supplement-intakes            Idempotency-Key: …
{ "occurredAt": "2026-09-27T07:40:00Z", "timeZone": "Europe/Lisbon", "supplementId": "a07e…" }
→ 201 { "id": …, "revision": 1, "localDate": "2026-09-27", "supplementId": "a07e…",
        "name": "Creatine monohydrate", "kind": "creatine", "dose": { "amount": 5, "unit": "g" } }
→ 404 when that supplement is not on the stack in force on that local day

GET /v1/days/2026-09-27
→ { …, "supplements": { "items": [ { "supplement": { …Vitamin D3 }, "intakes": [] },
                                    { "supplement": { …Creatine }, "intakes": [ { … } ] } ],
                        "unlisted": [] } }

DELETE /v1/supplement-intakes/{id}     If-Match: "1"
```

In the web app:

```tsx
const supplements = useSupplements(token, date, onConnect);   // in the page shell, like useWater
<SupplementsCard day={day?.supplements} pending={supplements.pending}
                 onTake={supplements.take} onUndo={supplements.remove} onManage={openStack} />

const stack = useSupplementStack(token, today);               // the dialog edits today's stack
const save = useSaveSupplementStack(token, today);
save.mutate([...stack.supplements, { id: crypto.randomUUID(), name, kind, dose }]);
```

## Shape

```ts
// src/supplements/contract.ts
supplementKinds = ["vitamin", "mineral", "creatine", "omega-3", "other"]
doseUnits = ["mg", "mcg", "g", "IU", "ml", "capsule", "tablet", "scoop", "drop"]
doseSchema = { amount: positive, ≤ 100000, 3 decimals; unit }
supplementSchema = { id: uuid; name: 1–80; kind; dose }                  // one line of the stack
supplementStackSchema = { supplements: Supplement[] ≤ 30, unique ids }  // the PUT body
stackForDaySchema = { effectiveFrom: date | null; supplements: Supplement[] }
intakeInputSchema = { occurredAt; timeZone; supplementId }
supplementIntakeSchema = recordBase + { supplementId; name; kind; dose }  // a snapshot
supplementDaySchema = { items: { supplement; intakes[] }[]; unlisted: intake[] }

// src/supplements/supplements.ts
stackKind: DatedKind<StackRow, SupplementStack, StackForDay>      // read and saved with getDated/saveDated, as targetsKind is
intakeRecords: RecordKind<IntakeInput, SupplementIntake>          // create resolves and snapshots the supplement
getSupplementDay(db, userId, date): Promise<SupplementDay>        // the stack in force, joined with the day's intakes
```

Tables: `supplement_stacks (user_id, effective_from, supplements jsonb, updated_at)` with primary key `(user_id, effective_from)`, and `supplement_intakes` with the shared journal columns plus `supplement_id`, `name`, `kind`, and `dose jsonb`.

Load-bearing decisions:

- **The stack is one effective-dated document.** It follows the same design as targets: both are `DatedKind` descriptors in `src/effective-dated.ts`, and `app.ts` registers their `GET`/`PUT` routes from the descriptor. A `PUT` replaces the whole list from that day on. Repeating it is harmless, so it needs no receipt. Callers never see versions or date ranges.
- **Supplement ids are client-generated and stay the same across versions.** The id is what links an intake to a line in the stack. Renaming a supplement or changing its dose keeps the id, so the checklist remembers that it was taken.
- **An intake names only the supplement, and the server fills in the details.** `create` looks up the supplement in the stack in force on the intake's local date and copies its name, kind, and dose. The client cannot send a dose that disagrees with the stack. Later stack edits never rewrite a logged intake. This follows the food snapshot rule.
- **"Not on the stack" is an outcome, not an exception.** A `RecordKind` with a `missingReference` message may return `null` from `create`, which becomes the `unknown-reference` outcome carrying that message. The receipt is discarded, as food does for `catalog-missing`, so the same key works again after the stack is fixed. This is the only change to the shared journal machinery.
- **The server builds the checklist.** `Day` gains `supplements`. The client does not join intakes to stack versions. An intake whose supplement was removed from that day's stack shows up in `unlisted`, so it can still be seen and undone.
- **Every active supplement is expected once a day.** A supplement with at least one intake that day counts as taken. There are no schedules yet.

The public surface is two stack routes, the two standard record routes, and one new field on the day. Callers do not handle the carry-forward, the snapshot, the join, or the receipt rules.

## Synthesis decision

Three structurally different shapes were compared. The arena runners were not available, so this comparison was done inline.

- **A: effective-dated stack plus snapshot intakes** (above).
- **B: supplement entities with a lifecycle.** Each supplement is a row with `started_on`/`stopped_on`, `POST/PATCH/DELETE /v1/supplements`, revisions, and receipts, plus the same intakes. It gives the same history, but it needs a new mutation module with create, edit, stop, resume, and delete commands and If-Match on every edit. The public surface is about twice the size for no capability that A lacks for one person.
- **C: journal only.** `supplement_entries` store name and dose each time. "My supplements" is derived from recent distinct entries, as in log-again. It is the smallest shape, but it cannot show a supplement you take and haven't ticked today, which is the feature being asked for. Rejected.

A is the base. From B it takes the rule that intakes point to a stable id, not a name. From C it takes the snapshot on every intake, so each entry reads on its own.

## Tradeoffs accepted

- We accept jsonb for the stack in exchange for a whole-list document with one version per day. Zod validates the list at the boundary, and the database checks only its shape. Workouts already store strength exercises this way.
- We accept that an intake can only reference a supplement on that day's stack. The UI offers only those supplements, so this matters only to other API clients.
- We accept that removing a supplement applies only from today on. Past days still list it as not taken. Removing it on the day you added it erases it completely, because a same-day save overwrites that day's version.
- We accept a once-a-day expectation for everything, even weekly doses, until schedules are needed.

## Alternatives considered

| Shape | Why it lost |
| --- | --- |
| Supplement rows with start/stop lifecycle (B) | Five mutation commands, revisions, and receipts where one idempotent `PUT` does the job. The history it records is the same. |
| Journal-only entries (C) | It cannot show supplements you haven't taken yet today, and the "list of what I take" is only a guess from history. |
| A separate `GET /v1/supplements/days/{date}` instead of a field on `Day` | That would add a second query key for intakes, and both would need invalidating after every tick. Water lives on `Day` for the same reason. |

## Open questions and risks

- Should a supplement have a schedule (twice daily, weekly), so the checklist can say "1 of 2" or skip off days?
- Should a one-off supplement be loggable without adding it to the stack, for example melatonin on a travel night?
- Should the dose be adjustable per intake, for example during a creatine loading phase, or is editing the stack enough?
- Should supplements count toward anything else, such as micronutrient totals? Right now they are tracked only as adherence.

## Next implementation step

Add the two tables and `src/supplements/contract.ts`, then write `stackKind`/`intakeRecords`/`getSupplementDay` against an integration test.
