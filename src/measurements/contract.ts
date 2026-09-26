import { z } from "zod";
import { recordBaseSchema } from "../journal/contract.js";
import { occurredAtSchema, timeZoneSchema } from "../time.js";

export const measurementKinds = ["weight", "height", "body-fat", "waist"] as const;

// Units are fixed per kind: kilograms, centimetres, percent, centimetres.
export const measurementLimits = {
  weight: { min: 20, max: 500 },
  height: { min: 50, max: 272 },
  "body-fat": { min: 2, max: 75 },
  waist: { min: 30, max: 300 },
} as const;

export const measurementKindSchema = z.enum(measurementKinds);

export const measurementInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  kind: measurementKindSchema,
  value: z.number(),
}).strict().refine(({ kind, value }) => value >= measurementLimits[kind].min && value <= measurementLimits[kind].max, "Value out of range for this measurement");

export const measurementSchema = recordBaseSchema.extend({
  kind: measurementKindSchema,
  value: z.number(),
});

const latestSchema = z.object({ value: z.number(), localDate: z.iso.date() }).nullable();

export const measurementSummarySchema = z.object({
  entries: z.array(measurementSchema),
  latest: z.object({ weight: latestSchema, height: latestSchema, "body-fat": latestSchema, waist: latestSchema }),
  weightChange: z.number().nullable(),
  weightHistory: z.array(z.object({ localDate: z.iso.date(), value: z.number() })),
  bmi: z.number().nullable(),
});

export type MeasurementKind = z.infer<typeof measurementKindSchema>;

export type MeasurementInput = z.infer<typeof measurementInputSchema>;

export type Measurement = z.infer<typeof measurementSchema>;

export type MeasurementSummary = z.infer<typeof measurementSummarySchema>;
