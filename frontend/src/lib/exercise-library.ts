import { queryOptions } from "@tanstack/react-query";
import { exerciseKey } from "../../../src/workouts/contract";
import { createCustomExercise, deleteCustomExercise, getExerciseLibrary, type CustomExercise, type Equipment, type ExerciseHistory, type LibraryExercise, type Muscle } from "./api";
import { queryRefresh } from "./query-refresh";
import { useIdempotentDelete, useIdempotentWrite } from "./use-idempotent";
import type { CustomExerciseInput } from "../../../src/exercises/contract";

export function exerciseLibraryQueryOptions() {
  // The catalog only changes with a deploy, and the person's own part refreshes after their writes.
  return queryOptions({ queryKey: ["exercise-library"], queryFn: getExerciseLibrary, staleTime: Infinity });
}

export const muscleLabels: Record<Muscle, string> = {
  abdominals: "Abs",
  abductors: "Abductors",
  adductors: "Adductors",
  biceps: "Biceps",
  calves: "Calves",
  chest: "Chest",
  forearms: "Forearms",
  glutes: "Glutes",
  hamstrings: "Hamstrings",
  lats: "Lats",
  "lower back": "Lower back",
  "middle back": "Upper back",
  neck: "Neck",
  quadriceps: "Quads",
  shoulders: "Shoulders",
  traps: "Traps",
  triceps: "Triceps",
};

export const equipmentLabels: Record<Equipment, string> = {
  barbell: "Barbell",
  dumbbell: "Dumbbell",
  machine: "Machine",
  cable: "Cable",
  kettlebell: "Kettlebell",
  band: "Band",
  bodyweight: "Bodyweight",
  "ez-bar": "EZ bar",
  "medicine-ball": "Medicine ball",
  "exercise-ball": "Exercise ball",
  "foam-roll": "Foam roller",
  other: "Other",
};

// "Quads · Barbell", or null for a name known only from workouts.
export function exerciseDetail(exercise: LibraryExercise): string | null {
  if (exercise.origin === "logged") return null;

  return [muscleLabels[exercise.muscle], exercise.equipment && equipmentLabels[exercise.equipment]].filter(Boolean).join(" · ");
}

export type PickerFilter = { query: string; muscle: Muscle | null; equipment: Equipment | null };

export type PickerGroups = { recent: LibraryExercise[]; all: LibraryExercise[] };

// What the picker lists. Recent holds exercises done on or before the date, the most recently done first, and
// only shows while nothing is searched or filtered. Every query word must appear in the name. Logged names have
// no muscle or equipment, so a filter hides them.
export function pickerGroups(library: LibraryExercise[], history: ExerciseHistory[], date: string, filter: PickerFilter): PickerGroups {
  const words = exerciseKey(filter.query).split(" ").filter(Boolean);

  const all = library.filter((exercise) => words.every((word) => exercise.key.includes(word))
    && (filter.muscle === null || (exercise.origin !== "logged" && exercise.muscle === filter.muscle))
    && (filter.equipment === null || (exercise.origin !== "logged" && exercise.equipment === filter.equipment)));

  if (words.length > 0 || filter.muscle !== null || filter.equipment !== null) return { recent: [], all };

  const byKey = new Map(library.map((exercise) => [exercise.key, exercise]));

  const recent = history
    .flatMap((exercise) => {
      const last = exercise.sessions.findLast((session) => session.date <= date);
      const known = byKey.get(exercise.key);

      return last && known ? [{ exercise: known, date: last.date }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8)
    .map(({ exercise }) => exercise);

  return { recent, all };
}

export function useCreateExercise(onCreated: (name: string) => void) {
  return useIdempotentWrite<CustomExerciseInput>((input, key) => createCustomExercise(key, input), {
    refresh: queryRefresh.exercises,
    success: (input) => `${input.name.trim()} added to your exercises.`,
    onSuccess: (input) => onCreated(input.name.trim()),
  });
}

export function useDeleteExercise() {
  return useIdempotentDelete<CustomExercise>((exercise, key) => deleteCustomExercise(exercise, key), {
    refresh: queryRefresh.exercises,
    success: (exercise) => `${exercise.name} removed from your exercises.`,
  });
}
