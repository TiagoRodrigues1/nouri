import { z } from "zod";
import { daySchema } from "../days/contract.js";
import { measurementSummarySchema } from "../measurements/contract.js";
import { photoSchema } from "../photos/contract.js";
import { sleepDaySchema } from "../sleep/contract.js";
import { supplementDaySchema } from "../supplements/contract.js";
import { workoutDaySchema } from "../workouts/contract.js";

export const overviewSchema = z.object({
  date: z.iso.date(),
  nutrition: daySchema.omit({ date: true, supplements: true }),
  sports: workoutDaySchema,
  measurements: measurementSummarySchema,
  sleep: sleepDaySchema,
  supplements: supplementDaySchema,
  // The most recent progress photos taken on or before the date, newest first.
  photos: z.array(photoSchema),
});

export type Overview = z.infer<typeof overviewSchema>;
