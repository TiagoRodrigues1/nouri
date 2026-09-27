import { getDay } from "../days/days.js";
import type { AppDatabase } from "../db/database.js";
import { getMeasurementSummary } from "../measurements/measurements.js";
import { getRecentPhotos } from "../photos/photos.js";
import { getSleepDay } from "../sleep/sleep.js";
import { getWorkoutDay } from "../workouts/workouts.js";
import type { Overview } from "./contract.js";

export async function getOverview(db: AppDatabase, userId: string, date: string): Promise<Overview> {
  const [day, sports, measurements, sleep, photos] = await Promise.all([
    getDay(db, userId, date),
    getWorkoutDay(db, userId, date),
    getMeasurementSummary(db, userId, date),
    getSleepDay(db, userId, date),
    getRecentPhotos(db, userId, date),
  ]);

  return { date, nutrition: { food: day.food, water: day.water }, sports, measurements, sleep, supplements: day.supplements, photos };
}
