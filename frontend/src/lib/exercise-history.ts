import { queryOptions } from "@tanstack/react-query";
import { exerciseKey } from "../../../src/workouts/contract";
import { format, getExerciseHistory, type ExerciseHistory, type ExerciseSession } from "./api";

// One response serves the workout form, the Progress page, and their date filters.
export function exerciseHistoryQueryOptions() {
  return queryOptions({ queryKey: ["exercise-history"], queryFn: getExerciseHistory });
}

// Sessions on or before the date, oldest first.
export function sessionsUpTo(exercise: ExerciseHistory, date: string): ExerciseSession[] {
  return exercise.sessions.filter((session) => session.date <= date);
}

// The latest session of the exercise a typed name matches, on or before the date.
export function lastSession(exercises: ExerciseHistory[], name: string, date: string): ExerciseSession | null {
  const key = exerciseKey(name);
  const exercise = key === "" ? undefined : exercises.find((candidate) => candidate.key === key);

  return exercise?.sessions.findLast((session) => session.date <= date) ?? null;
}

// "3 × 8 · 60 kg, 1 × 12 · 50 kg"
export function setsLabel(session: ExerciseSession): string {
  return session.sets.map((set) => `${set.sets} × ${set.reps}${set.weightKg === null ? "" : ` · ${format(set.weightKg, 1)} kg`}`).join(", ");
}
