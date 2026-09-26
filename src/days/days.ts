import { getFoodDay } from "../food/food.js";
import type { AppDatabase } from "../db/database.js";
import { getWaterDay } from "../water/water.js";
import type { Day } from "./contract.js";

export async function getDay(db: AppDatabase, userId: string, date: string): Promise<Day> {
  const [food, water] = await Promise.all([getFoodDay(db, userId, date), getWaterDay(db, userId, date)]);

  return { ...food, water };
}
