import { z } from "zod";
import type { BpmRange } from "../daily-totals/contract.js";
import type { ImportKind } from "../wearables/contract.js";

const activityAndFitness = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

// The read-only scope each kind Nouri imports needs; every other Google Health scope stays unrequested.
// Exercise, steps, and active energy sit under activity and fitness, heart rate under health metrics:
// https://developers.google.com/health/scopes
export const scopes = {
  sleep: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  workouts: activityAndFitness,
  activity: activityAndFitness,
  heartRate: "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
} as const satisfies Record<ImportKind, string>;

export const syncWindowDays = 30;

export type GoogleHealthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch: typeof fetch;
};

// Google's response shapes, parsed at the boundary. Unknown fields pass through untouched.
export const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(""),
  token_type: z.string(),
});

export const tokenErrorSchema = z.object({ error: z.string() });

// Google Duration strings, used for UTC offsets and lengths alike, like "-14400s".
const durationSchema = z.string().regex(/^-?\d+(\.\d+)?s$/);

const timestampSchema = z.iso.datetime({ offset: true });

// int64 fields arrive as strings, so numbers are coerced.
const numberSchema = z.coerce.number().finite();

const twoDigits = (value: number) => String(value).padStart(2, "0");

// A local date as Google writes it, like { "year": 2026, "month": 9, "day": 24 }, read as "2026-09-24".
const civilDateSchema = z.object({ year: z.number().int().min(1).max(9999), month: z.number().int().min(1).max(12), day: z.number().int().min(1).max(31) })
  .transform(({ year, month, day }) => `${String(year).padStart(4, "0")}-${twoDigits(month)}-${twoDigits(day)}`).pipe(z.iso.date());

const deviceSourceSchema = z.object({
  device: z.object({ displayName: z.string().optional(), manufacturer: z.string().optional(), model: z.string().optional() }).optional(),
}).optional();

// Enum fields stay strings, so a stage type Google adds later is ignored instead of rejecting the night.
export const sleepDataPointSchema = z.object({
  name: z.string().min(1),
  dataSource: deviceSourceSchema,
  sleep: z.object({
    interval: z.object({
      startTime: timestampSchema,
      startUtcOffset: durationSchema.optional(),
      endTime: timestampSchema,
      endUtcOffset: durationSchema.optional(),
    }),
    type: z.string().optional(),
    stages: z.array(z.object({ startTime: timestampSchema, endTime: timestampSchema, type: z.string() })).optional(),
    summary: z.object({
      stagesSummary: z.array(z.object({ type: z.string(), minutes: z.coerce.number().int().min(0) })).optional(),
    }).optional(),
    createTime: timestampSchema.optional(),
    updateTime: timestampSchema.optional(),
  }),
});

export type SleepDataPoint = z.infer<typeof sleepDataPointSchema>;

// Exercise sessions from https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints.
export const exerciseDataPointSchema = z.object({
  name: z.string().min(1),
  dataSource: deviceSourceSchema,
  exercise: z.object({
    interval: z.object({
      startTime: timestampSchema,
      startUtcOffset: durationSchema.optional(),
      endTime: timestampSchema,
      endUtcOffset: durationSchema.optional(),
    }),
    exerciseType: z.string().optional(),
    displayName: z.string().optional(),
    // Moving time without pauses.
    activeDuration: durationSchema.optional(),
    metricsSummary: z.object({
      caloriesKcal: numberSchema.optional(),
      distanceMillimeters: numberSchema.optional(),
    }).optional(),
    createTime: timestampSchema.optional(),
    updateTime: timestampSchema.optional(),
  }),
});

export type ExerciseDataPoint = z.infer<typeof exerciseDataPointSchema>;

// A page of any data type. Each point is parsed on its own, so one odd record does not stop the rest.
export const dataPageSchema = z.object({
  dataPoints: z.array(z.object({ name: z.string().min(1) }).loose()).default([]),
  nextPageToken: z.string().optional(),
});

// One resting heart rate per local day, from the daily-resting-heart-rate data type.
export const restingHeartRatePointSchema = z.object({
  name: z.string().min(1),
  dailyRestingHeartRate: z.object({ date: civilDateSchema, beatsPerMinute: numberSchema }),
});

export type RestingHeartRatePoint = z.infer<typeof restingHeartRatePointSchema>;

// A page from dataPoints:dailyRollUp: one bucket per local day, from
// https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/dailyRollUp.
// Google leaves out the value, or the whole bucket, for a day without data.
export const rollupPageSchema = z.object({
  rollupDataPoints: z.array(z.object({ civilStartTime: z.object({ date: civilDateSchema }) }).loose()).default([]),
  nextPageToken: z.string().optional(),
});

// The value each rollup carries, or null when the day has none.
export const stepsRollupSchema = z.object({ steps: z.object({ countSum: numberSchema }).optional() })
  .transform((bucket) => bucket.steps?.countSum ?? null);

export const activeEnergyRollupSchema = z.object({ activeEnergyBurned: z.object({ kcalSum: numberSchema }).optional() })
  .transform((bucket) => bucket.activeEnergyBurned?.kcalSum ?? null);

export const heartRateRollupSchema = z.object({
  heartRate: z.object({ beatsPerMinuteAvg: numberSchema, beatsPerMinuteMin: numberSchema, beatsPerMinuteMax: numberSchema }).optional(),
}).transform(({ heartRate }): BpmRange | null => heartRate ? { averageBpm: heartRate.beatsPerMinuteAvg, minBpm: heartRate.beatsPerMinuteMin, maxBpm: heartRate.beatsPerMinuteMax } : null);
