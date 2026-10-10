import { queryOptions } from "@tanstack/react-query";
import { exerciseKey } from "../../../src/workouts/contract";
import { format, getExerciseHistory, type ExerciseHistory, type ExerciseSession } from "./api";

// One response serves the workout form, the Progress page, and their date filters.
export function exerciseHistoryQueryOptions() {
  return queryOptions({ queryKey: ["exercise-history"], queryFn: getExerciseHistory });
}

// The latest session of the exercise a typed name matches, on or before the date.
export function lastSession(exercises: ExerciseHistory[], name: string, date: string): ExerciseSession | null {
  const key = exerciseKey(name);
  const exercise = key === "" ? undefined : exercises.find((candidate) => candidate.key === key);

  return exercise?.sessions.findLast((session) => session.date <= date) ?? null;
}

// The names of the exercises done on or before the date, the most recently done first, to suggest while typing.
export function exerciseNames(exercises: ExerciseHistory[], date: string): string[] {
  return exercises
    .flatMap((exercise) => {
      const last = exercise.sessions.findLast((session) => session.date <= date);

      return last ? [{ name: exercise.name, date: last.date }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((exercise) => exercise.name);
}

// "3 × 8 · 60 kg, 1 × 12 · 50 kg"
export function setsLabel(session: ExerciseSession): string {
  return session.sets.map((set) => `${set.sets} × ${set.reps}${set.weightKg === null ? "" : ` · ${format(set.weightKg, 1)} kg`}`).join(", ");
}
