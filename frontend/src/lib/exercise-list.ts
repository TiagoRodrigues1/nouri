import { maxRoutineExercises, maxRoutineSets } from "../../../src/routines/contract.js";

type Item = { id: string };

// An exercise with its sets, as the routine editor and the live workout both list them.
type ListedExercise = Item & { name: string; sets: Item[] };

type SetOf<E extends ListedExercise> = E["sets"][number];

// Changes the exercise (or set) with the id, or removes it when the change returns null. The same list comes back
// when the id is unknown or the change returns the item as it was, so a caller can tell nothing happened.
export function changeById<T extends Item>(items: T[], id: string, change: (item: T) => T | null): T[] {
  const index = items.findIndex((item) => item.id === id);
  const item = items[index];

  if (!item) return items;
  const next = change(item);

  if (next === item) return items;

  return next ? items.with(index, next) : items.toSpliced(index, 1);
}

// Moves the item with the id one place up (-1) or down (1). The same list comes back when the id is unknown or the
// item is already at that end.
export function moveById<T extends Item>(items: T[], id: string, offset: -1 | 1): T[] {
  const index = items.findIndex((item) => item.id === id);
  const item = items[index];
  const other = items[index + offset];

  if (!item || !other) return items;

  return items.with(index, other).with(index + offset, item);
}

// Changes one set of one exercise, or removes it when the change returns null.
export function changeSet<E extends ListedExercise>(exercises: E[], exerciseId: string, setId: string, change: (set: SetOf<E>) => SetOf<E> | null): E[] {
  return changeById(exercises, exerciseId, (exercise) => {
    const sets = changeById(exercise.sets, setId, change);

    return sets === exercise.sets ? exercise : { ...exercise, sets };
  });
}

// Adds a set after the exercise's last, which the new set may copy, unless the exercise is at the limit.
export function appendSet<E extends ListedExercise>(exercises: E[], exerciseId: string, set: (last: SetOf<E> | undefined) => SetOf<E>): E[] {
  return changeById(exercises, exerciseId, (exercise) => (exercise.sets.length >= maxRoutineSets ? exercise : { ...exercise, sets: [...exercise.sets, set(exercise.sets.at(-1))] }));
}

// Adds an exercise at the end, unless the list is at the limit.
export function appendExercise<E extends Item>(exercises: E[], exercise: E): E[] {
  return exercises.length >= maxRoutineExercises ? exercises : [...exercises, exercise];
}
