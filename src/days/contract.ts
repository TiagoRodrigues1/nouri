import { z } from "zod";
import { daySchema as foodDaySchema } from "../food/contract.js";
import { supplementDaySchema } from "../supplements/contract.js";
import { waterDaySchema } from "../water/contract.js";

export const daySchema = foodDaySchema.extend({ water: waterDaySchema, supplements: supplementDaySchema });

export type Day = z.infer<typeof daySchema>;
