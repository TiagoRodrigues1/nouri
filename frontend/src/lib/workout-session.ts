import { z } from "zod";
import { repTargetSchema, type RepTarget, type Routine } from "../../../src/routines/contract.js";
import { localDate } from "../../../src/time.js";
import { appendExercise, appendSet, changeById, changeSet } from "./exercise-list.js";
import { exerciseKey, workoutInputSchema, type ExerciseHistory, type ExerciseSession, type WorkoutInput } from "../../../src/workouts/contract.js";

// What a done set is worth. A null weight is bodyweight.
export type SetValues = { weightKg: number | null; reps: number };

const sessionSetSchema = z.object({
  id: z.string(),
  // From the routine; null for a set of an exercise added during the session.
  target: repTargetSchema.nullable(),
  // Fields hold text while typing, so a half-typed "62." is not rewritten under the cursor.
  weight: z.string(),
  reps: z.string(),
  // done ⇒ parseSet(set) !== null, kept by reduce alone.
  done: z.boolean(),
});

const sessionExerciseSchema = z.object({ id: z.string(), name: z.string(), sets: z.array(sessionSetSchema) });

// The exact request Finish sends, and its key, kept until the server answers.
const frozenFinishSchema = z.object({ key: z.string(), input: workoutInputSchema });

export const sessionSchema = z.object({
  id: z.string(),
  // Where it came from. Editing or deleting the routine later changes nothing here.
  routine: z.object({ id: z.string(), name: z.string() }).nullable(),
  title: z.string(),
  // Elapsed time is always derived from it, never counted, so a suspended tab wakes up showing the right time.
  startedAt: z.iso.datetime({ offset: true }),
  // The zone at start, so the workout's date is the day it began.
  timeZone: z.string(),
  exercises: z.array(sessionExerciseSchema),
  finish: frozenFinishSchema.nullable(),
});

export type SessionSet = z.infer<typeof sessionSetSchema>;

export type SessionExercise = z.infer<typeof sessionExerciseSchema>;

export type FrozenFinish = z.infer<typeof frozenFinishSchema>;

export type Session = z.infer<typeof sessionSchema>;

// Every change a session can take. Ids are minted by the caller, so reduce stays pure.
export type SessionAction =
  | { type: "edit-set"; exerciseId: string; setId: string; field: "weight" | "reps"; text: string }
  | { type: "complete-set"; exerciseId: string; setId: string; fallback: SetValues | null }
  | { type: "reopen-set"; exerciseId: string; setId: string }
  | { type: "copy-previous"; exerciseId: string; setId: string; values: SetValues }
  | { type: "add-set"; exerciseId: string; setId: string }
  | { type: "remove-set"; exerciseId: string; setId: string }
  | { type: "add-exercise"; exerciseId: string; setId: string; name: string }
  | { type: "replace-exercise"; exerciseId: string; name: string }
  | { type: "remove-exercise"; exerciseId: string }
  | { type: "freeze"; finish: FrozenFinish }
  | { type: "thaw" };

export type SessionStats = { elapsedSeconds: number; volumeKg: number; doneSets: number };

export type Ids = () => string;

const emptySet = (id: string, target: RepTarget | null): SessionSet => ({ id, target, weight: "", reps: "", done: false });

// A routine copied set by set, every set open and empty; null starts an empty workout.
export function startSession(routine: Routine | null, startedAt: string, timeZone: string, ids: Ids): Session {
  return {
    id: ids(),
    routine: routine && { id: routine.id, name: routine.name },
    title: routine?.name ?? "Workout",
    startedAt,
    timeZone,
    exercises: (routine?.exercises ?? []).map((exercise) => ({
      id: ids(),
      name: exercise.name,
      sets: exercise.sets.map((set) => emptySet(ids(), set.reps)),
    })),
    finish: null,
  };
}

// A weight field's kilograms from 0 to 1000: null when empty, which is bodyweight, and undefined when it is not a
// weight. Some phone keyboards type a decimal comma.
export function parseWeight(text: string): number | null | undefined {
  const weight = text.trim().replace(",", ".");

  if (weight === "") return null;
  const weightKg = Number(weight);

  return Number.isFinite(weightKg) && weightKg >= 0 && weightKg <= 1000 ? weightKg : undefined;
}

// A reps field's whole number from 1 to 1000, or null.
export function parseReps(text: string): number | null {
  const reps = /^\s*\d+\s*$/.test(text) ? Number(text) : 0;

  return reps >= 1 && reps <= 1000 ? reps : null;
}

// A set's typed values, or null when either field does not parse.
export function parseSet(set: Pick<SessionSet, "weight" | "reps">): SetValues | null {
  const weightKg = parseWeight(set.weight);
  const reps = parseReps(set.reps);

  return weightKg !== undefined && reps !== null ? { weightKg, reps } : null;
}

// "8" or "8-12"; an en dash or spaces around the dash work too.
export function parseRepTarget(text: string): RepTarget | null {
  const match = /^\s*(\d+)\s*(?:[-–]\s*(\d+)\s*)?$/.exec(text);

  if (!match) return null;
  const min = Number(match[1]);
  const target = repTargetSchema.safeParse({ min, max: match[2] === undefined ? min : Number(match[2]) });

  return target.success ? target.data : null;
}

export function repTargetText(target: RepTarget): string {
  return target.min === target.max ? String(target.min) : `${target.min}–${target.max}`;
}

export function weightText(weightKg: number): string {
  return String(Math.round(weightKg * 100) / 100);
}

// "62kg × 7", or "× 12" for bodyweight.
export function previousLabel(values: SetValues): string {
  return `${values.weightKg === null ? "" : `${weightText(values.weightKg)}kg `}× ${values.reps}`;
}

function valuesText(values: SetValues): Pick<SessionSet, "weight" | "reps"> {
  return { weight: values.weightKg === null ? "" : weightText(values.weightKg), reps: String(values.reps) };
}

// The session with its exercises changed; the same session when they are unchanged.
function withExercises(session: Session, exercises: SessionExercise[]): Session {
  return exercises === session.exercises ? session : { ...session, exercises };
}

// Empty fields take the fallback; a set that still does not parse stays open.
function complete(set: SessionSet, fallback: SetValues | null): SessionSet {
  if (set.done) return set;

  const filled = {
    weight: set.weight.trim() === "" && fallback?.weightKg != null ? weightText(fallback.weightKg) : set.weight,
    reps: set.reps.trim() === "" && fallback ? String(fallback.reps) : set.reps,
  };

  const values = parseSet(filled);

  return values ? { ...set, ...valuesText(values), done: true } : set;
}

// The only way a session changes. It returns the same object when an action does not apply: an unknown id, a
// frozen session, a set that does not parse, or a limit reached. Editing a done set to text that does not parse
// reopens it, so a done set always parses.
export function reduce(session: Session, action: SessionAction): Session {
  if (action.type === "thaw") return session.finish ? { ...session, finish: null } : session;

  if (session.finish) return session;

  const { exercises } = session;

  switch (action.type) {
    case "freeze":
      return { ...session, finish: action.finish };
    case "edit-set":
      return withExercises(session, changeSet(exercises, action.exerciseId, action.setId, (set) => {
        const next = { ...set, [action.field]: action.text };

        return { ...next, done: next.done && parseSet(next) !== null };
      }));
    case "complete-set":
      return withExercises(session, changeSet(exercises, action.exerciseId, action.setId, (set) => complete(set, action.fallback)));
    case "reopen-set":
      return withExercises(session, changeSet(exercises, action.exerciseId, action.setId, (set) => (set.done ? { ...set, done: false } : set)));
    case "copy-previous":
      return withExercises(session, changeSet(exercises, action.exerciseId, action.setId, (set) => ({ ...set, ...valuesText(action.values) })));
    case "remove-set":
      return withExercises(session, changeSet(exercises, action.exerciseId, action.setId, () => null));
    case "add-set":
      return withExercises(session, appendSet(exercises, action.exerciseId, (last) => emptySet(action.setId, last?.target ?? null)));
    case "add-exercise":
      return withExercises(session, appendExercise(exercises, { id: action.exerciseId, name: action.name, sets: [emptySet(action.setId, null)] }));
    case "replace-exercise":
      // The plan's targets stay; what was typed or done belonged to the other exercise.
      return withExercises(session, changeById(exercises, action.exerciseId, (exercise) => ({ ...exercise, name: action.name, sets: exercise.sets.map((set) => emptySet(set.id, set.target)) })));
    case "remove-exercise":
      return withExercises(session, changeById(exercises, action.exerciseId, () => null));
  }
}

function doneValues(exercise: SessionExercise): SetValues[] {
  return exercise.sets.flatMap((set) => {
    const values = set.done ? parseSet(set) : null;

    return values ? [values] : [];
  });
}

export function sessionStats(session: Session, now: number): SessionStats {
  const done = session.exercises.flatMap(doneValues);

  return {
    elapsedSeconds: Math.max(0, Math.floor((now - Date.parse(session.startedAt)) / 1000)),
    volumeKg: done.reduce((volume, set) => volume + (set.weightKg ?? 0) * set.reps, 0),
    doneSets: done.length,
  };
}

// The local date the session began on, in its own zone: the workout's date, and PREVIOUS's cut-off.
export function sessionDate(session: Session): string {
  return localDate(session.startedAt, session.timeZone);
}

export function defaultDuration(session: Session, now: number): number {
  return Math.min(1440, Math.max(1, Math.round((now - Date.parse(session.startedAt)) / 60_000)));
}

// The workout the session logs, dated when it started: done sets only, in screen order, with consecutive equal
// sets of an exercise merged into one row, so 62×7, 62×7, 60×8 is two rows.
export function toWorkoutInput(session: Session, durationMinutes: number): WorkoutInput {
  const rows: NonNullable<WorkoutInput["strengthExercises"]> = [];

  for (const exercise of session.exercises) {
    let last: (typeof rows)[number] | undefined;

    for (const set of doneValues(exercise)) {
      if (last && last.reps === set.reps && last.weightKg === set.weightKg) {
        last.sets += 1;
      } else {
        last = { name: exercise.name, sets: 1, reps: set.reps, weightKg: set.weightKg };
        rows.push(last);
      }
    }
  }

  return {
    occurredAt: session.startedAt,
    timeZone: session.timeZone,
    activity: "strength",
    durationMinutes,
    distanceM: null,
    energyKcal: null,
    strengthExercises: rows.length > 0 ? rows : null,
  };
}

// Rows back to one entry per set, in order: the inverse of the merge in toWorkoutInput.
export function expandSets(rows: ExerciseSession["sets"]): SetValues[] {
  return rows.flatMap((row) => Array.from({ length: row.sets }, () => ({ weightKg: row.weightKg, reps: row.reps })));
}

// Each set of the exercise's latest session on or before the date. Rows logged as "3 × 8" give three sets, so
// workouts from the form and MCP count too.
export function previousSets(history: ExerciseHistory[], name: string, date: string): SetValues[] {
  const key = exerciseKey(name);
  const last = history.find((exercise) => exercise.key === key)?.sessions.findLast((session) => session.date <= date);

  return last ? expandSets(last.sets) : [];
}

// What ticking an empty row fills in, as its placeholders show: the weight done last time, and the low end of the
// routine's rep target, or else the reps done last time. Null when there are no reps to fill.
export function setPlaceholder(previous: SetValues | null, target: RepTarget | null): SetValues | null {
  const reps = target?.min ?? previous?.reps;

  return reps === undefined ? null : { weightKg: previous?.weightKg ?? null, reps };
}

// The reps field's placeholder: the routine's target, or else the reps done last time.
export function repsPlaceholder(previous: SetValues | null, target: RepTarget | null): string {
  if (target) return repTargetText(target);

  return previous ? String(previous.reps) : "";
}
