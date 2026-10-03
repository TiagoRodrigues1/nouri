# Workout history and progression

## Problem

Nouri records strength exercises inside each workout, but Overview shows them one day at a time. To know what you lifted last time you had to step back through days until you found the exercise. The feature shows the previous sets and weights while you log an exercise, and charts each exercise over time.

The data shapes the design. An exercise is free text inside the `strength_exercises` jsonb of a workout, with one `sets × reps × weight` per row. Nothing links "Squat" on Monday to "squat" on Thursday except the name. People sometimes log one exercise twice in a workout to record a lighter set. Imported workouts have no exercises. Deleted workouts must drop out of the history.

## Usage (caller's view)

While logging a strength workout, each exercise card shows the last time that exercise was done, on or before the dialog's date, as you type its name:

```
Exercise name  [ squat            ]
Last time, Thu 24 Sep: 3 × 8 · 60 kg            [Repeat]
```

**Repeat** copies the session's first row, usually the working sets, into the card. The sidebar has a **Progress** page. It lists the exercises you have logged, most recent first, charts the selected one, and lists its sessions newest first, each linking to that day in Overview. The chart shows the top weight per session, or total reps for an exercise that never had a weight. The page reads history up to the header's date, so stepping back shows what you knew then. Exercise names in the Overview sports card link to their progress.

```ts
const { exercises } = await getExerciseHistory();
// exercises[0].name === "Squat", exercises[0].key === "squat"
// exercises[0].sessions.at(-1) → { date: "2026-09-24", sets: [{ sets: 3, reps: 8, weightKg: 60 }], topWeightKg: 60, totalReps: 24, volumeKg: 1440, ... }

lastSession(exercises, " SQUAT", "2026-10-01"); // the 24 Sep session, matched by exerciseKey
```

`GET /v1/workouts/exercises` returns that shape.

## Shape

```
src/workouts/contract.ts      exerciseKey(name), exerciseSessionSchema, exerciseHistorySchema, exerciseHistoryListSchema
src/workouts/workouts.ts      getExerciseHistory(db, userId): fold strength workouts into per-exercise sessions
src/app.ts                    GET /v1/workouts/exercises
frontend/src/lib/exercise-history.ts   query options, lastSession(exercises, name, date), sessionsUpTo(exercise, date)
frontend/src/overview-dialogs.tsx      LastTime line and Repeat in each exercise card
frontend/src/progress.tsx              the /progress page: picker, chart, session table
frontend/src/overview/sports.tsx       exercise names link to /progress
```

```ts
// One spelling per exercise: trimmed, inner spaces collapsed, lowercase. Shared by the server and the page.
export function exerciseKey(name: string): string;

type ExerciseSession = {
  workoutId: string;
  date: string;          // the workout's local date
  occurredAt: string;
  sets: { sets: number; reps: number; weightKg: number | null }[]; // the exercise's rows in that workout, in logged order
  topWeightKg: number | null;  // null when every row is bodyweight
  totalReps: number;           // sets × reps, summed over the rows
  volumeKg: number | null;     // null when any row lacks a weight, so a partial sum is never shown
};

type ExerciseHistory = { key: string; name: string /* latest spelling */; sessions: ExerciseSession[] /* oldest first */ };

getExerciseHistory(db, userId): Promise<{ exercises: ExerciseHistory[] /* most recently done first */ }>;
```

The workouts module owns the read, as it owns the day and range reads, per the review design. One query reads the user's active workouts that have exercises, oldest by local date and then by time, and one pass groups their rows by `exerciseKey`. Sessions and the derived numbers come from the server, so the null rules for bodyweight and volume live in one place. `exerciseKey` sits in the contract because the page has to match a name being typed against the history, and both sides must use the same rule.

The interface is one call with no parameters. The page filters by date itself (`sessionsUpTo`, `lastSession`), so the form, the Progress page, and the Overview link share one cached response under the `exercise-history` query key. Workout writes already refresh their reads through `queryRefresh.workout`, which gains that key.

The design adds no schema change and no new write path.

## Synthesis decision

There were three candidates. **A**, the server-derived history above. **B**, a normalized `exercise_sets` table written next to the jsonb, with an indexed exercise key. **C**, a client fan-out that fetches workouts and builds the history in the page.

B gives indexed per-exercise reads, but it stores every exercise twice, adds a second write that must stay in step with workout creation and deletion, and needs a schema change. A personal journal holds a few hundred strength workouts a year, so one indexed scan of the user's workouts is cheap and B buys nothing it needs yet. C needs no new endpoint, but it moves name matching and the bodyweight and volume rules into the page, and it needs a workout list endpoint that does not exist. A hides all of that behind one call and one schema, so it is the base. From B it takes the idea of a stable exercise key, computed at read time instead of stored. From C it takes client-side date filtering, which keeps the endpoint free of parameters.

## Tradeoffs accepted

- A card holds one sets × reps × weight, so Repeat copies only the first row of a session that had several. The sketch had Repeat copy the whole session; the form would have had to add cards, which it otherwise only does when you ask.
- The displayed name is the latest spelling, so typing "squat" once renames the exercise to lowercase everywhere.

- We accept reading all of a user's strength workouts on each history request in exchange for no schema change and no second copy of the data. If history grows past a few thousand sessions, the read can move to SQL (`jsonb_array_elements`) or a cap without changing the response.
- Names are matched by `exerciseKey` only. "Back squat" and "Squat" remain separate exercises; there is no rename or merge.
- A session's chart value is its top weight. Rep progress at the same weight shows in the table, not the line.
- The form has no name autocomplete; the Last time line is the cue that a name matched.

## Alternatives considered

- **A per-exercise endpoint** (`/v1/workouts/exercises/{key}` plus a list endpoint). Two calls and a `before` parameter for the form, for a payload that is small anyway.
- **Estimated one-rep max as the chart metric.** It mixes rep ranges into one number, but it is a formula people disagree on, and the top weight is what was actually lifted.

## Open questions and risks

- Should exercise names autocomplete from history? That would need a shadcn Combobox, which the project does not have yet.
- Should Progress ignore the header date and always show everything?
