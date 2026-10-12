# Workout routines and live sessions

## Problem

A strength workout is logged after the fact, as one `sets × reps × weight` per exercise. Apps like Hevy work the other way round. You save a routine once, with its exercises, sets, and a rep target for each set (8, or 8–12). In the gym you start the routine, and for each set you enter the weight and reps you did and tick it done. The table shows what you lifted in that set last time.

The existing system constrains the design. A workout is an immutable journal record whose `strength_exercises` jsonb holds `{ name, sets, reps, weightKg }` rows. History, Progress, Overview, Review, and MCP all read those rows and match exercises by `exerciseKey(name)`. A workout with several rows for one exercise is already read as one session with several rows. Stored workouts are never rewritten. Each account may make 120 writes an hour.

## Usage (caller's view)

The sidebar gains **Workouts**, between Meals and Overview.

```
/workouts                               /workouts/session
[ Start empty workout ]  [ New routine ]   Push day                         [ Finish ]
┌ Push day                (body map) ┐    Time 32:10   Volume 4 210 kg   Sets 11
│ Bench press · Overhead press · …   │    (figure) Barbell Bench Press
│ 5 exercises · 17 sets              │    SET  PREVIOUS    KG     REPS     ✓
│ [Start]  [Edit]                    │    1    62kg × 7    62     7        ✓   green row
└────────────────────────────────────┘    2    62kg × 7    ·62·   ·8–12·   ☐
                                           [ + Add set ]
/workouts/routines/new                     [ + Add exercise ]       [ Discard workout ]
/workouts/routines/$routineId
  name; exercises from the picker; per exercise a SET | REPS table where REPS is "8" or "8-12"; + Add set
```

While a workout is in progress, every page shows a bar, `Push day · 32:10 · Resume`. Empty fields show placeholders: the weight lifted in that set last time, and the routine's rep target, or else last time's reps. Ticking a row with empty fields fills them from the placeholders, as Hevy does. A done row turns green. Finish opens a dialog with only the duration, the elapsed time, which can be edited. Unticked sets are left out. **Save workout** writes one ordinary strength workout dated when the session started, then opens Overview on that day. Reloading, switching apps, or a killed tab change nothing, because the clock is derived from the start time. If Save fails offline, the dialog offers **Retry**, and a retry never logs the workout twice.

The old **+ Log → Exercise** dialog stays, for runs and for strength workouts logged after the fact.

```tsx
const routines = useRoutines();
const workout = useWorkoutSession();

const started = workout.start(routine);                     // or null for an empty workout
if (started.outcome === "in-progress") askToResumeOrDiscard(started.session);
else navigate({ to: "/workouts/session" });

workout.dispatch({ type: "edit-set", exerciseId, setId, field: "weight", text: "62.5" });
workout.dispatch({ type: "complete-set", exerciseId, setId, fallback: setPlaceholder(previous[i], set.target) });
workout.dispatch({ type: "add-set", exerciseId });
workout.finish.save({ durationMinutes: 52 });               // freezes, persists, sends; retry() resends the same key
```

```http
GET    /v1/routines                               → { routines: Routine[] }   newest first
POST   /v1/routines       Idempotency-Key         → 201 Routine
PATCH  /v1/routines/{id}  Idempotency-Key, If-Match → 200 Routine            replaced whole
DELETE /v1/routines/{id}  Idempotency-Key, If-Match → 204
```

Finish uses the existing `POST /v1/workouts`.

## Shape

```
db/migrations/0007-workout-routines.sql
src/routines/contract.ts          repTargetSchema, routineInputSchema, routineSchema, routineListSchema, limits
src/routines/routines.ts          listRoutines, mutateRoutine (create, edit, delete; receipts and revisions)
src/app.ts                        the four routine routes
src/workouts/contract.ts          maxStrengthRows: input cap 30 → 400 (MCP keeps 30)
src/exercises/*                   muscles: { primary, secondary } on catalog and custom exercises
scripts/import-exercises.py       keeps primaryMuscles and secondaryMuscles; data/free-exercise-db.json regenerated

frontend/src/lib/workout-session.ts      pure: Session, SessionAction, startSession, reduce, parseSet, sessionStats,
                                         toWorkoutInput, expandSets, previousSets, setPlaceholder, labels
frontend/src/lib/use-workout-session.ts  the one draft per account in localStorage, Finish protocol, useNow
frontend/src/lib/routines.ts             query options and the routine write hooks
frontend/src/lib/body-map.ts             Nouri muscles → body regions; the shapes are vendored from react-body-highlighter (MIT)
frontend/src/muscle-map.tsx              <MuscleMap muscles size="thumb" | "full" />
frontend/src/workouts/*                  routines page, routine editor, session page, set table, styles
```

```ts
// One shape for "8" and "8–12": an exact target is a range whose ends meet, so readers never branch.
type RepTarget = { min: number; max: number };                       // 1 ≤ min ≤ max ≤ 1000
type RoutineExercise = { name: string; sets: { reps: RepTarget }[] }; // 1–20 sets
type Routine = { id: string; revision: number; name: string; exercises: RoutineExercise[] }; // 1–20 exercises

type SessionSet = { id: string; target: RepTarget | null; weight: string; reps: string; done: boolean };
type Session = {
  id: string;
  routine: { id: string; name: string } | null;
  title: string;
  startedAt: string;     // elapsed time is derived from it, never counted
  timeZone: string;
  exercises: { id: string; name: string; sets: SessionSet[] }[];
  finish: { key: string; input: WorkoutInput } | null;   // frozen request, until the server answers
};
```

**Routines copy saved meals.** A routine is one `workout_routines` row with its exercises in jsonb, read and written whole, revisioned, soft-deleted, behind one `mutateRoutine(db, userId, key, command)` wrapped in `withReceipt`. Exercises are named, as workouts are, so deleting a custom exercise leaves routines alone. Items have no ids, because a session copies the routine whole and never refers back.

**The live session is a client-owned draft.** It is a value changed only through a pure `reduce(session, action)`. Elapsed time, volume, set counts, PREVIOUS, placeholders, and the workout it logs are all derived from it and from cached server reads. `useWorkoutSession` keeps one draft per account in localStorage, under `nouri.workout-session.<clerk user id>`, in a `{ version: 1, session }` envelope parsed with zod. A value that does not parse is never dropped silently, and the page offers only Discard. `dispatch` is `write(reduce(read(), action))`, run synchronously, so two tabs merge one action at a time instead of overwriting each other. `useSyncExternalStore` with the `storage` event re-renders every tab. `start` never replaces a draft, and clearing is compare-and-delete by session id. The reducer keeps one invariant: a done set always parses. Editing a done set to text that does not parse reopens it.

**Finish freezes, then sends.** `finish.save` builds `toWorkoutInput`, checks it with the shared `workoutInputSchema`, and writes `{ key, input }` into the draft before it sends anything. While a draft is frozen, the reducer ignores every edit. A 201 clears the draft, refreshes `queryRefresh.workout`, and navigates to Overview. A network error, 5xx, 401, or 409 leaves the outcome unknown, so the dialog offers only Retry, which resends the same key and body, or Discard. A 400 or 413 means nothing was stored, so the draft unfreezes. On mount, a frozen draft resends itself once. The receipt replays `created` for the same key, so every step can run twice and still log one workout.

**A finished session is ordinary rows.** Done sets are run-length encoded per exercise, in screen order. Consecutive done sets with equal reps and weight become one `{ name, sets: n, reps, weightKg }` row, so 62×7, 62×7, 60×8 gives two rows. `getExerciseHistory` already folds several rows into one session, so Progress, Overview, Review, and MCP need no change. `expandSets` inverts the encoding exactly.

**PREVIOUS is derived.** For set *i* it is `expandSets(lastSession(history, name, sessionDate).sets)[i]`, read from the cached `exercise-history` query. Old manual logs such as "3 × 8 · 60 kg" expand to three sets, so PREVIOUS works for history from before routines.

**The muscle figure is each exercise's picture.** Free illustrations of exercises with the target muscles highlighted, like Hevy's, are licensed commercially (Gym Visual). So every exercise thumbnail, in the picker, the workout dialog, and the routine and session pages, is an anatomical figure, and the catalog no longer carries upstream's photos. It shows the side or sides holding the primary muscles, the primary muscles in a strong colour and the secondary muscles in a light one. A name only your workouts have keeps the dumbbell. The snapshot now keeps upstream's `primaryMuscles` and `secondaryMuscles`, and the library returns `muscles: { primary, secondary }` in Nouri's own muscle names. `muscle` stays as `primary[0]` for the picker filter. Custom exercises have `{ primary: [muscle], secondary: [] }`, and logged names have none. The mapping to body regions lives only in `frontend/src/lib/body-map.ts`. The polygon shapes are vendored from react-body-highlighter (MIT) instead of installing it, because the package hard-codes a pointer cursor and inline fills on every muscle. The page uses theme colours, so the figure works in dark mode.

The public surface is four routine routes, one `useWorkoutSession()` hook, and `<MuscleMap>`. Behind them sit storage scoping and versioning, the cross-tab merge, the freeze-and-retry protocol, run-length encoding, and the PREVIOUS derivation.

## Synthesis decision

Two candidates were sketched.

- **A: a server-owned session.** The tables were `workout_sessions`, `session_exercises`, and `session_sets`. Each set was a last-writer-wins register with a per-device clock, sent through one batch `PATCH` route. There was a device outbox for offline edits, and Finish ran in one transaction. A session resumes on another device. The costs were five more routes, three tables, an exemption from `Idempotency-Key`, a second rate allowance (a live session would exhaust 120 writes an hour), polling, and a clock protocol for readers to learn.
- **B: a client-owned draft (chosen).** This is the design above.

B is the base. It hides the same gym concerns (reloads, a killed tab, a lost Finish response, two tabs) behind a smaller surface, and it adds no session state that the server must expire or clean up. A's only gain is cross-device resume, which nobody asked for. From A it takes the warning that per-set writes would trip the hourly write limit, which confirms that Finish should be the only write.

## Tradeoffs accepted

- We accept that a session lives in one browser profile. It cannot move from the phone to the laptop, and clearing site data loses an unfinished one. In exchange, the server holds no session state and nothing is written per set.
- We accept a 400-row workout input cap, up from 30, in exchange for logging each done set faithfully. 400 is 20 exercises × 20 sets, which bounds the worst case. The encoding keeps a typical session to one or two rows per exercise, and MCP keeps its 30.
- We accept that after an unclear Finish failure the only choices are Retry or Discard, in exchange for never logging a workout twice.
- We accept that the workout does not record its routine or name. Overview shows "Strength training · 52 min" as today, and no workout column changes.
- We accept that PREVIOUS matches sets by position. A warm-up set added in front shifts the comparison by one.
- We accept that a done set needs at least one rep, as the workout schema does.
- Routines have no notes, rest timers, or warm-up set types. Nobody asked for them, and none would survive into the workout record.

## Alternatives considered

- **A server-owned session** (A above). It exposes a write per edit over a gym connection, a clock protocol, and cleanup of abandoned sessions. All of that buys a cross-device resume.
- **An in-progress row in `workouts` with a status.** Every reader (history, Overview, Review, summary, MCP, export) would have to filter it out, and journal records would stop being immutable.
- **One row per set (`sets: 1`).** A 5 × 5 would become five Overview lines, and every session would push the row cap. Run-length encoding costs a few lines and inverts exactly.
- **The react-body-highlighter package as a dependency.** It is unmaintained since 2022 and forces a pointer cursor and inline fills. Its shapes are data, so vendoring them costs nothing.

## Open questions and risks

- Should manual workouts gain a title, so Overview says "Push day"? It needs a `title` on the workout input and relaxing `workouts_source_identity`.
- Should Finish offer to update the routine with the sets done, as Hevy does?
- Should the Overview tile group one exercise's rows into one line, now that sessions produce more of them?

## Next implementation step

Write `frontend/src/lib/workout-session.ts` and its unit tests, including a round trip through the run-length encoding and `expandSets`.
