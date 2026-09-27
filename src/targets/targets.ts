import { userTargets } from "../db/schema.js";
import type { DatedKind } from "../effective-dated.js";
import { defaultTargets, targetsForDaySchema, targetsSchema } from "./contract.js";
import type { Targets, TargetsForDay } from "./contract.js";

type TargetsRow = typeof userTargets.$inferSelect;

// Named field by field so a column added to the table never reaches the response unannounced.
function targetsForDay(row: TargetsRow): TargetsForDay {
  return {
    effectiveFrom: row.effectiveFrom,
    targets: {
      kcal: row.kcal,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      waterMl: row.waterMl,
      steps: row.steps,
      sleepMinutes: row.sleepMinutes,
      fastingHours: row.fastingHours,
      burnedKcal: row.burnedKcal,
      exerciseMinutes: row.exerciseMinutes,
      workouts: row.workouts,
      weightKg: row.weightG === null ? null : row.weightG / 1000,
    },
  };
}

export const targetsKind: DatedKind<typeof userTargets, Targets, TargetsForDay> = {
  table: userTargets,
  input: targetsSchema,
  schema: targetsForDaySchema,
  empty: { effectiveFrom: null, targets: defaultTargets },
  toResult: targetsForDay,
  values: ({ weightKg, ...daily }) => ({ ...daily, weightG: weightKg === null ? null : Math.round(weightKg * 1000) }),
};
