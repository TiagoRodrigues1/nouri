import { z } from "zod";
import { wearableProviderSchema } from "../wearables/contract.js";

// The values a day's totals may hold. Anything outside is unknown. The CHECKs in db/schema.sql use the same bounds.
export const dailyLimits = {
  steps: { min: 0, max: 200_000 },
  activeKcal: { min: 0, max: 20_000 },
  bpm: { min: 20, max: 250 },
} as const;

const bpm = z.number().int();

// The day's average, lowest, and highest heart rate, which come together or not at all.
export const bpmRangeSchema = z.object({ averageBpm: bpm, minBpm: bpm, maxBpm: bpm });

// A local day's steps and active energy from a wearable. Null when nothing was imported for the day, never zeros.
export const activityDaySchema = z.object({
  steps: z.number().int().nullable(),
  activeKcal: z.number().int().nullable(),
  provider: wearableProviderSchema,
}).nullable();

// A local day's resting heart rate and its range, in beats per minute. Null when nothing was imported for the day.
export const heartRateDaySchema = z.object({
  restingBpm: bpm.nullable(),
  range: bpmRangeSchema.nullable(),
  provider: wearableProviderSchema,
}).nullable();

export type BpmRange = z.infer<typeof bpmRangeSchema>;

export type ActivityDay = z.infer<typeof activityDaySchema>;

export type HeartRateDay = z.infer<typeof heartRateDaySchema>;
