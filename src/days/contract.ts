import { z } from "zod";
import { daySchema as foodDaySchema } from "../food/contract.js";
import { mealLogRefSchema } from "../meals/contract.js";
import { supplementDaySchema } from "../supplements/contract.js";
import { waterDaySchema } from "../water/contract.js";

// mealLogs names the saved meal logs the day's foods came from, so they can be shown and removed together.
export const daySchema = foodDaySchema.extend({ water: waterDaySchema, supplements: supplementDaySchema, mealLogs: z.array(mealLogRefSchema) });

export type Day = z.infer<typeof daySchema>;
