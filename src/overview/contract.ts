import { z } from "zod";
import { measurementSummarySchema } from "../measurements/contract.js";
import { photoSchema } from "../photos/contract.js";
import { sleepDaySchema } from "../sleep/contract.js";
import { workoutDaySchema } from "../workouts/contract.js";

export const overviewSchema = z.object({
  date: z.iso.date(),
  sports: workoutDaySchema,
  measurements: measurementSummarySchema,
  sleep: sleepDaySchema,
  // The most recent progress photos taken on or before the date, newest first.
  photos: z.array(photoSchema),
});

export type Overview = z.infer<typeof overviewSchema>;
