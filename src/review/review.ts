import type { AppDatabase } from "../db/database.js";
import { getFoodRange } from "../food/food.js";
import { getWeightRange } from "../measurements/measurements.js";
import { getSleepRange } from "../sleep/sleep.js";
import { shiftDate } from "../time.js";
import { getWorkoutRange } from "../workouts/workouts.js";
import { reviewDays } from "./contract.js";
import type { Review, ReviewDay } from "./contract.js";

// The seven local days ending on `to`. A day without a record of a kind reads null for it, never zero.
export async function getReview(db: AppDatabase, userId: string, to: string): Promise<Review> {
  const from = shiftDate(to, 1 - reviewDays);

  const [food, workouts, sleep, weights] = await Promise.all([
    getFoodRange(db, userId, from, to),
    getWorkoutRange(db, userId, from, to),
    getSleepRange(db, userId, from, to),
    getWeightRange(db, userId, from, to),
  ]);

  const days = Array.from({ length: reviewDays }, (_, index): ReviewDay => {
    const date = shiftDate(from, index);
    const workout = workouts.get(date);
    const night = sleep.get(date);

    return {
      date,
      food: food.get(date) ?? { entryCount: 0, kcal: null, proteinG: null },
      workouts: { entryCount: workout?.entryCount ?? 0, totalMinutes: workout?.totalMinutes ?? null },
      sleep: { sessionCount: night?.sessionCount ?? 0, totalMinutes: night?.totalMinutes ?? null },
      weightKg: weights.get(date) ?? null,
    };
  });

  const counted = (recorded: (day: ReviewDay) => boolean) => days.filter(recorded).length;

  return {
    from,
    to,
    days,
    recordedDays: {
      food: counted((day) => day.food.entryCount > 0),
      workouts: counted((day) => day.workouts.entryCount > 0),
      sleep: counted((day) => day.sleep.sessionCount > 0),
      weight: counted((day) => day.weightKg !== null),
      any: counted((day) => day.food.entryCount > 0 || day.workouts.entryCount > 0 || day.sleep.sessionCount > 0 || day.weightKg !== null),
    },
  };
}
