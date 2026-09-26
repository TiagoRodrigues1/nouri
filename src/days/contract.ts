import { z } from "zod";
import { daySchema as foodDaySchema } from "../food/contract.js";
import { waterDaySchema } from "../water/contract.js";

export const daySchema = foodDaySchema.extend({ water: waterDaySchema });

export type Day = z.infer<typeof daySchema>;
