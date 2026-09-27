import { z } from "zod";
import type { ImportKind } from "../wearables/contract.js";

// One read-only scope per kind Nouri imports; every other Google Health scope stays unrequested.
// Exercise sits under activity and fitness: https://developers.google.com/health/scopes
export const scopes = {
  sleep: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  workouts: "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
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

const deviceSourceSchema = z.object({
  device: z.object({ manufacturer: z.string().optional(), model: z.string().optional() }).optional(),
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

const numberSchema = z.coerce.number().finite();

// Exercise sessions from https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints.
// int64 fields arrive as strings, so numbers are coerced.
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
