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
- **Each supplement carries its own schedule.** By default a supplement is due once a day, every day. A schedule can narrow it to some weekdays or ask for it more than once a day. See [Schedules](#schedules).

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

## Alternatives considered

| Shape | Why it lost |
| --- | --- |
| Supplement rows with start/stop lifecycle (B) | Five mutation commands, revisions, and receipts where one idempotent `PUT` does the job. The history it records is the same. |
| Journal-only entries (C) | It cannot show supplements you haven't taken yet today, and the "list of what I take" is only a guess from history. |
| A separate `GET /v1/supplements/days/{date}` instead of a field on `Day` | That would add a second query key for intakes, and both would need invalidating after every tick. Water lives on `Day` for the same reason. |

## Open questions and risks

- Should a one-off supplement be loggable without adding it to the stack, for example melatonin on a travel night?
- Should the dose be adjustable per intake, for example during a creatine loading phase, or is editing the stack enough?
- Should supplements count toward anything else, such as micronutrient totals? Right now they are tracked only as adherence.

## Schedules

### Problem

Every supplement used to be due once every day. Some people take magnesium twice a day, or a vitamin B12 tablet only on Mondays and Thursdays. The checklist marked those off days as missed, never asked for the second dose, and the review counted those days against adherence.

### Usage (caller's view)

```http
PUT /v1/supplement-stack/2026-10-19
{ "supplements": [
  { "id": "…", "name": "Magnesium", "kind": "mineral", "dose": { "amount": 200, "unit": "mg" },
    "schedule": { "weekdays": [1, 2, 3, 4, 5, 6, 7], "timesPerDay": 2 } },
  { "id": "…", "name": "Vitamin B12", "kind": "vitamin", "dose": { "amount": 1, "unit": "tablet" },
    "schedule": { "weekdays": [1, 4], "timesPerDay": 1 } } ] }

GET /v1/days/2026-10-19        (a Monday)
→ "supplements": { "items": [ { "supplement": { …Magnesium }, "due": 2, "intakes": [ { … } ] },
                              { "supplement": { …Vitamin B12 }, "due": 1, "intakes": [] } ], "unlisted": [] }
GET /v1/days/2026-10-20        (a Tuesday): Vitamin B12 has "due": 0
```

```tsx
const { rows, taken, total } = checklist(day);   // total counts supplements due today; taken counts those with every dose
// row.complete, row.offDay, row.progress ("1 of 2"); the card shows an undo chip for the last intake and, while
// doses remain, a tick for the next one.
```

### Shape

```ts
// src/supplements/contract.ts
supplementScheduleSchema = { weekdays: IsoWeekday[1..7] unique, default every day; timesPerDay: 1..4, default 1 }
supplementSchema += { schedule: supplementScheduleSchema, default { every day, once } }
supplementDaySchema.items[] += { due: int }          // doses expected that day; 0 on an off day
dueOn(supplement, date): number                      // the one rule, used by the day and the range

// src/supplements/supplements.ts
SupplementRangeDay = { intakeCount; taken; due }     // due: supplements due that day; taken: those with every dose
// src/review/contract.ts: day.supplements.stackSize → due; period.supplements.stackDays → dueDays
```

Load-bearing decisions:

- **The schedule is part of the supplement, inside the stack document.** It is effective-dated with the rest of the list, so changing a schedule leaves earlier days as they were. The stack is jsonb, so the change needs no migration. Stored lists from before schedules are read through the schema, so they default to once every day.
- **Intakes do not check the schedule.** Taking B12 on a Tuesday, or magnesium a third time, is logged like any other intake. The schedule only decides what the day expects. Off-day supplements stay on the checklist, muted and outside the count, so they can still be ticked.
- **The server computes `due`.** The client does not repeat the weekday rule. The range uses the same `dueOn`, so the review and the checklist agree.
- **A supplement counts as taken once all its doses are in.** A twice-daily supplement with one intake is not finished. The review's "every supplement taken" days count only the supplements due that day. A day with nothing due is not counted.
- **Doses are counted, not slotted.** "Twice a day" means two intakes, with no morning or evening slots. Each intake keeps its own time, so the times are recorded anyway.

### Synthesis decision

The arena runners were not available, so this comparison was done inline, as in the first design.

- **A: schedule field on each stack line, `due` per checklist item** (above). One optional field on the PUT body and one number on the day's items.
- **B: named dose slots.** The schedule lists slots such as `morning` and `evening`, and each intake names its slot. The checklist gets a row per slot. Intakes would need a new column, edits would need slot validation, and the MCP tools would need slot ids. The only gain is a label on each dose, and the intake time already says when it was taken.
- **C: a separate effective-dated schedule document keyed by supplement id.** This keeps the stack untouched, but the two documents could disagree: a schedule for a supplement no longer on the stack, or a stack line without a schedule. Every reader would have to join them.

A hides the most behind the smallest surface. Old clients and receipts still work, because the schedule defaults to what every supplement meant before.

### Tradeoffs accepted

- At most four doses a day. More than that is a regimen, not a checklist.
- No weekly or every-other-day cadence beyond choosing weekdays. "Every 3 days" would need an anchor date. Weekdays cover the common cases.
- Off-day supplements still appear on the checklist. Hiding them would make an off-day intake impossible to log from the card.

## Next implementation step

Add the two tables and `src/supplements/contract.ts`, then write `stackKind`/`intakeRecords`/`getSupplementDay` against an integration test.
