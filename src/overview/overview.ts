import type { AppDatabase } from "../db/database.js";
import { getMeasurementSummary } from "../measurements/measurements.js";
import { getRecentPhotos } from "../photos/photos.js";
import { getSleepDay } from "../sleep/sleep.js";
import { getWorkoutDay } from "../workouts/workouts.js";
import type { Overview } from "./contract.js";

// Food, water, and supplements are read from the day, so the overview leaves them out.
export async function getOverview(db: AppDatabase, userId: string, date: string): Promise<Overview> {
  const [sports, measurements, sleep, photos] = await Promise.all([
    getWorkoutDay(db, userId, date),
    getMeasurementSummary(db, userId, date),
    getSleepDay(db, userId, date),
    getRecentPhotos(db, userId, date),
  ]);

  return { date, sports, measurements, sleep, photos };
}
