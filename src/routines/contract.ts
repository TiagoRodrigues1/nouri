import { z } from "zod";
import { strengthExerciseSchema } from "../workouts/contract.js";

export const maxRoutineExercises = 20;

export const maxRoutineSets = 20;

const repCount = strengthExerciseSchema.shape.reps;

// One shape for "8" and "8–12": an exact target is a range whose ends meet, so readers never branch.
export const repTargetSchema = z.object({ min: repCount, max: repCount }).strict()
  .refine((target) => target.min <= target.max, "The lower rep target cannot exceed the upper one");

// Each set has its own target, so "1 × 5, then 3 × 8–10" is a routine, and a session copies it set by set.
export const routineSetSchema = z.object({ reps: repTargetSchema }).strict();

// Named, as workouts and the library are, so a routine never refers to a library id.
export const routineExerciseSchema = z.object({
  name: strengthExerciseSchema.shape.name,
  sets: z.array(routineSetSchema).min(1).max(maxRoutineSets),
}).strict();

// The whole routine. Creating and editing send the same body, and an edit replaces the routine.
export const routineInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  exercises: z.array(routineExerciseSchema).min(1).max(maxRoutineExercises),
}).strict();

export const routineSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  name: z.string(),
  exercises: z.array(routineExerciseSchema),
});

export const routineListSchema = z.object({ routines: z.array(routineSchema) });

export type RepTarget = z.infer<typeof repTargetSchema>;

export type RoutineExercise = z.infer<typeof routineExerciseSchema>;

export type RoutineInput = z.infer<typeof routineInputSchema>;

export type Routine = z.infer<typeof routineSchema>;

export type RoutineList = z.infer<typeof routineListSchema>;
