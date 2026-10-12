import { z } from "zod";
import { strengthExerciseSchema } from "../workouts/contract.js";

// The catalog's own muscle and equipment names, which custom exercises share so one filter covers both.
export const muscles = ["abdominals", "abductors", "adductors", "biceps", "calves", "chest", "forearms", "glutes", "hamstrings", "lats", "lower back", "middle back", "neck", "quadriceps", "shoulders", "traps", "triceps"] as const;

export const equipment = ["barbell", "dumbbell", "machine", "cable", "kettlebell", "band", "bodyweight", "ez-bar", "medicine-ball", "exercise-ball", "foam-roll", "other"] as const;

const muscleSchema = z.enum(muscles);

const equipmentSchema = z.enum(equipment).nullable();

// Primary first; secondary never repeats a primary. `muscle` stays beside it as primary[0], for the picker filter.
export const muscleMapSchema = z.object({ primary: z.array(muscleSchema).min(1), secondary: z.array(muscleSchema) });

export const customExerciseInputSchema = z.object({
  name: strengthExerciseSchema.shape.name,
  muscle: muscleSchema,
  equipment: equipmentSchema,
}).strict();

export const customExerciseSchema = z.object({
  origin: z.literal("custom"),
  id: z.uuid(),
  revision: z.number().int(),
  key: z.string(),
  name: z.string(),
  muscle: muscleSchema,
  muscles: muscleMapSchema,
  equipment: equipmentSchema,
});

export const libraryExerciseSchema = z.discriminatedUnion("origin", [
  z.object({ origin: z.literal("catalog"), key: z.string(), name: z.string(), muscle: muscleSchema, muscles: muscleMapSchema, equipment: equipmentSchema }),
  customExerciseSchema,
  // A name from the person's workouts that neither the catalog nor their custom exercises have.
  z.object({ origin: z.literal("logged"), key: z.string(), name: z.string() }),
]);

// Sorted by name. Keys are unique: the catalog wins over custom exercises, and both win over logged names.
export const exerciseLibrarySchema = z.object({
  exercises: z.array(libraryExerciseSchema),
  attribution: z.object({ label: z.string(), url: z.url() }),
});

export type Muscle = z.infer<typeof muscleSchema>;

export type MuscleMap = z.infer<typeof muscleMapSchema>;

export type Equipment = (typeof equipment)[number];

export type CustomExerciseInput = z.infer<typeof customExerciseInputSchema>;

export type CustomExercise = z.infer<typeof customExerciseSchema>;

export type LibraryExercise = z.infer<typeof libraryExerciseSchema>;

export type ExerciseLibrary = z.infer<typeof exerciseLibrarySchema>;
