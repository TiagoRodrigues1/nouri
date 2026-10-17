# User targets

## Problem

The web app judges each day against numbers hard-coded in `frontend/src/lib/goals.ts`: the FDA reference macros, 2,000 ml of water, 8 hours of sleep, a 16-hour fast, and the activity ring goals. Nobody can change them, the server does not know about them, and a native client would have to copy them. This slice makes targets per-user data owned by the API.

A target is not a journal record like water or a workout. It is a setting that stays in force until the person changes it. A setting still has history, though. When someone lowers their energy target on 3 September, the report for 1 September should still be judged against the old target. The code already has both precedents. `dashboard_layouts` shows per-user state that the client replaces in full and that has defaults. Measurements show a value that carries forward: the day view uses the latest value on or before that date.

## Usage (caller's view)

```http
GET /v1/targets/2026-09-01
→ 200 { "effectiveFrom": null, "targets": { "kcal": 2000, "proteinG": 50, … , "weightKg": null } }

PUT /v1/targets/2026-09-03
{ "kcal": 1800, "proteinG": 120, "carbsG": 180, "fatG": 60, "waterMl": 2500, "steps": 10000,
  "sleepMinutes": 480, "fastingHours": 16, "burnedKcal": 400, "exerciseMinutes": 30, "workouts": 1, "weightKg": 72.5 }
→ 200 { "effectiveFrom": "2026-09-03", "targets": { … } }

GET /v1/targets/2026-09-01  → still the defaults, effectiveFrom null
GET /v1/targets/2026-09-20  → the 3 September targets, effectiveFrom "2026-09-03"
```

In the web app:

```tsx
const targets = useTargets(token, date);          // loading, error with retry, or ready; defaults only when disconnected
if (targets.status === "ready") <Gauge value={totals?.kcal} target={targets.targets.kcal} … />

const save = useSaveTargets(token, today);
save.mutate(nextTargets);                         // the web app always passes today's local date
```

## Shape

```ts
// src/targets/contract.ts
targetsSchema = z.object({ kcal, proteinG, carbsG, fatG, waterMl, steps, sleepMinutes,
                           fastingHours, burnedKcal, exerciseMinutes, workouts,   // integers with bounds
                           weightKg: number | null }).strict()
targetsForDaySchema = z.object({ effectiveFrom: iso date | null, targets: targetsSchema })
defaultTargets: Targets

// src/targets/targets.ts
getTargets(db, userId, date): Promise<TargetsForDay>             // latest row with effective_from <= date, else defaults
saveTargets(db, userId, effectiveFrom, targets): Promise<TargetsForDay>  // upsert on (user_id, effective_from)
```

The table is `user_targets (user_id, effective_from, <one column per target>, updated_at)` with primary key `(user_id, effective_from)`. Each target has its own typed column and a `CHECK`, which matches the other tables. Weight is stored as `weight_g`, an integer, to avoid float columns.

Load-bearing decisions:

- **The target set is one object.** Clients read and replace every target together, the same way the dashboard layout works. Because the `PUT` replaces the whole set, repeating it is harmless, so it needs no idempotency key or receipt. This follows make-operations-idempotent.
- **Effective-dating stays behind `getTargets`.** Callers pass the day they are rendering. They never see rows, ranges, or defaults logic. `effectiveFrom: null` is the one place where "you never set targets" becomes visible.
- **Defaults live in `defaultTargets` in the contract.** The server returns them, and the web app uses them only when it is disconnected. A failed read while connected is shown as an error with a retry, never as the defaults. The FDA values move there from `goals.ts`.
- **Weight has no default.** Its value is `null`, which means there is no weight goal. Every other target is a positive daily amount. A daily target of 0 would make a gauge meaningless, so the schema rejects it.
- **Targets are not part of `/v1/days` or `/v1/overview`.** There is one read path and one frontend query key (`["targets", token, date]`). Saving invalidates the `["targets"]` prefix.

The public surface is two functions and two routes. Callers do not handle the carry-forward lookup, the defaults, the unit conversion, or the upsert.

## Synthesis decision

I compared two structurally different candidates.

- **A: current-settings document.** One row per user, like `dashboard_layouts`, with `GET/PUT /v1/targets`. It is the simplest option, but changing a target rewrites how every past day looks. That breaks the "a stored day does not change after the fact" rule that food entries follow with nutrient snapshots.
- **B: effective-dated targets.** One row per change, and the lookup is carry-forward, the same query shape as `getMeasurementSummary`'s `latest`.

B is the base. Its public surface is the same size as A's: the date only moves into the path, and the reader gains the right history. From A it takes the full-replacement `PUT`, defaults until the first save, and no receipts. B originally had a separate row per target kind. I dropped that: the table would be key/value in all but name, validation would be spread across kinds, and a partial save could leave a mixed set.

## Tradeoffs accepted

- We accept a new row for every save day in exchange for correct history. Saving twice on the same day overwrites that day's row.
- We accept one `ALTER TABLE … ADD COLUMN IF NOT EXISTS` per future target in exchange for typed, checked columns.
- We accept that the web app always saves from today, even while it shows a past day. Editing targets means "from now on". It never rewrites history from the UI.
- We accept storing a steps target before any steps data exists, because the person asked for it. The UI shows it only in the targets form.

## Alternatives considered

| Shape | Why it lost |
| --- | --- |
| One current-targets row per user | Past days change whenever targets change. The interface is no smaller than the effective-dated version. |
| Key/value rows per target kind (`kind`, `value`, `effective_from`) | Per-kind validation and units leak into every reader. Partial saves create mixed sets. Reads need pivoting. |
| Targets embedded in `Day` and `Overview` responses | The same data would travel through three paths and three query keys that all need invalidating. |

## Open questions and risks

- Suggesting targets from a profile and a goal direction (lose, maintain, or gain) is designed in `target-suggestions-design.md`. The profile sits beside `targets` and never saves targets itself.
- Steps have no data source yet. Should the target stay hidden until wearable import lands?

## Next implementation step

Add the `user_targets` table and `src/targets/contract.ts`. Then implement `getTargets` and `saveTargets` against the integration test.
