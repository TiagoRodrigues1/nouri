import { z } from "zod";
import { recordBaseSchema } from "../journal/contract.js";
import { occurredAtSchema, timeZoneSchema } from "../time.js";

export const waterInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  volumeMl: z.number().int().min(1).max(5000),
}).strict();

export const waterEntrySchema = recordBaseSchema.extend({
  volumeMl: z.number().int().positive(),
});

export const waterDaySchema = z.object({
  entries: z.array(waterEntrySchema),
  entryCount: z.number().int(),
  totalMl: z.number().int().nullable(),
});

export type WaterInput = z.infer<typeof waterInputSchema>;

export type WaterEntry = z.infer<typeof waterEntrySchema>;

export type WaterDay = z.infer<typeof waterDaySchema>;
