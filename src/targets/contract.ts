import { z } from "zod";
import { measurementLimits } from "../measurements/contract.js";

// Named on their own so the targets form can offer the same bounds the API enforces.
export const targetLimits = {
  kcal: { min: 500, max: 10_000 },
  proteinG: { min: 1, max: 1000 },
  carbsG: { min: 1, max: 1000 },
  fatG: { min: 1, max: 1000 },
  waterMl: { min: 250, max: 10_000 },
  steps: { min: 100, max: 100_000 },
  sleepMinutes: { min: 60, max: 960 },
  fastingHours: { min: 1, max: 23 },
  burnedKcal: { min: 10, max: 5000 },
  exerciseMinutes: { min: 1, max: 600 },
  workouts: { min: 1, max: 10 },
  weightKg: measurementLimits.weight,
} as const;

// Daily amounts are positive integers: a zero target would make every gauge meaningless.
function daily({ min, max }: { min: number; max: number }) {
  return z.number().int().min(min).max(max);
}

export const targetsSchema = z.object({
  kcal: daily(targetLimits.kcal),
  proteinG: daily(targetLimits.proteinG),
  carbsG: daily(targetLimits.carbsG),
  fatG: daily(targetLimits.fatG),
  waterMl: daily(targetLimits.waterMl),
  steps: daily(targetLimits.steps),
  sleepMinutes: daily(targetLimits.sleepMinutes),
  fastingHours: daily(targetLimits.fastingHours),
  burnedKcal: daily(targetLimits.burnedKcal),
  exerciseMinutes: daily(targetLimits.exerciseMinutes),
  workouts: daily(targetLimits.workouts),
  // A goal weight rather than a daily amount; null means the person has not set one.
  weightKg: z.number().min(targetLimits.weightKg.min).max(targetLimits.weightKg.max).nullable(),
}).strict();

export const targetsForDaySchema = z.object({
  // The day these targets took effect; null while the person has never saved any.
  effectiveFrom: z.iso.date().nullable(),
  targets: targetsSchema,
});

export type Targets = z.infer<typeof targetsSchema>;

export type TargetsForDay = z.infer<typeof targetsForDaySchema>;

// FDA reference daily values for a 2,000 kcal diet, plus common activity and sleep goals.
export const defaultTargets: Targets = {
  kcal: 2000,
  proteinG: 50,
  carbsG: 275,
  fatG: 78,
  waterMl: 2000,
  steps: 10_000,
  sleepMinutes: 480,
  fastingHours: 16,
  burnedKcal: 400,
  exerciseMinutes: 30,
  workouts: 1,
  weightKg: null,
};
