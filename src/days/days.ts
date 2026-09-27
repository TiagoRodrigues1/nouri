import { getFoodDay } from "../food/food.js";
import type { AppDatabase } from "../db/database.js";
import { getSupplementDay } from "../supplements/supplements.js";
import { getWaterDay } from "../water/water.js";
import type { Day } from "./contract.js";

export async function getDay(db: AppDatabase, userId: string, date: string): Promise<Day> {
  const [food, water, supplements] = await Promise.all([getFoodDay(db, userId, date), getWaterDay(db, userId, date), getSupplementDay(db, userId, date)]);

  return { ...food, water, supplements };
}
