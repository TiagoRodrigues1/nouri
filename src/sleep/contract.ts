import { z } from "zod";
import { sleepRecordBaseSchema } from "../journal/contract.js";
import { occurredAtSchema, timeZoneSchema } from "../time.js";

const minutes = z.number().int().min(0).max(1440);

export const stagesSchema = z.object({ awake: minutes, light: minutes, deep: minutes, rem: minutes }).strict();

export const sleepInputSchema = z.object({
  startedAt: occurredAtSchema,
  endedAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  stages: stagesSchema.nullable(),
}).strict().superRefine(({ startedAt, endedAt, stages }, context) => {
  const length = (Date.parse(endedAt) - Date.parse(startedAt)) / 60_000;

  if (length <= 0 || length > 1440) context.addIssue({ code: "custom", message: "Sleep must end after it starts and last at most 24 hours" });

  if (stages && stages.awake + stages.light + stages.deep + stages.rem > Math.round(length)) context.addIssue({ code: "custom", message: "Stages are longer than the session" });
});

export const sleepSessionSchema = sleepRecordBaseSchema.extend({
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  durationMinutes: z.number().int(),
  stages: stagesSchema.nullable(),
});

export const sleepDaySchema = z.object({
  sessions: z.array(sleepSessionSchema),
  totalMinutes: z.number().int().nullable(),
  // Null unless every session has stages.
  stages: stagesSchema.nullable(),
});

export type SleepInput = z.infer<typeof sleepInputSchema>;

export type SleepSession = z.infer<typeof sleepSessionSchema>;

export type SleepDay = z.infer<typeof sleepDaySchema>;

export type Stages = z.infer<typeof stagesSchema>;
