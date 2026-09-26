import { z } from "zod";

export const recordBaseSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  occurredAt: z.iso.datetime(),
  timeZone: z.string(),
  localDate: z.iso.date(),
});

export const sleepRecordBaseSchema = recordBaseSchema.omit({ occurredAt: true });
