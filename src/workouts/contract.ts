import { z } from "zod";
import { recordBaseSchema } from "../journal/contract.js";
import { occurredAtSchema, timeZoneSchema } from "../time.js";

export const activities = ["strength", "run", "walk", "cycle", "swim", "other"] as const;

export const strengthExerciseSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sets: z.number().int().min(1).max(100),
  reps: z.number().int().min(1).max(1000),
  weightKg: z.number().min(0).max(1000).nullable(),
}).strict();

export const workoutInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  activity: z.enum(activities),
  durationMinutes: z.number().int().min(1).max(1440),
  distanceM: z.number().int().min(1).max(1_000_000).nullable(),
  energyKcal: z.number().int().min(0).max(10_000).nullable(),
  strengthExercises: z.array(strengthExerciseSchema).max(30).nullable().default(null),
}).strict().superRefine((input, context) => {
  if (input.activity === "strength" && input.distanceM !== null) {
    context.addIssue({ code: "custom", path: ["distanceM"], message: "Strength workouts cannot have a distance." });
  }

  if (input.activity !== "strength" && input.strengthExercises !== null) {
    context.addIssue({ code: "custom", path: ["strengthExercises"], message: "Exercises are only for strength workouts." });
  }
});

export const workoutSchema = recordBaseSchema.extend({
  activity: z.enum(activities),
  durationMinutes: z.number().int(),
  distanceM: z.number().int().nullable(),
  energyKcal: z.number().int().nullable(),
  strengthExercises: z.array(strengthExerciseSchema).nullable(),
});

export const workoutDaySchema = z.object({
  entries: z.array(workoutSchema),
  entryCount: z.number().int(),
  totalMinutes: z.number().int().nullable(),
  // Null when any workout lacks an estimate, so a partial sum is never shown as the day's total.
  energyKcal: z.number().int().nullable(),
});

export const workoutSummarySchema = workoutDaySchema.pick({ entryCount: true, totalMinutes: true });

export type WorkoutSummary = z.infer<typeof workoutSummarySchema>;

export type Activity = z.infer<typeof workoutSchema>["activity"];

export type WorkoutInput = z.infer<typeof workoutInputSchema>;

export type Workout = z.infer<typeof workoutSchema>;

export type StrengthExercise = z.infer<typeof strengthExerciseSchema>;

export type WorkoutDay = z.infer<typeof workoutDaySchema>;
