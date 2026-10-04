import type { AppDatabase } from "../db/database.js";
import { getDatedHistory } from "../effective-dated.js";
import { getFoodRange } from "../food/food.js";
import { getWeightRange } from "../measurements/measurements.js";
import { getSleepRange } from "../sleep/sleep.js";
import { shiftDate } from "../time.js";
import { targetsKind } from "../targets/targets.js";
import { getWorkoutRange } from "../workouts/workouts.js";
import { calorieTolerance, isCompleteFood, reviewDays } from "./contract.js";
import type { Review, ReviewDay } from "./contract.js";

type CompleteDay = { kcal: number; proteinG: number; targets: ReviewDay["targets"] };

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compare(days: CompleteDay[], nutrient: "kcal" | "proteinG", onTarget: (value: number, target: number) => boolean): Review["nutrition"]["kcal"] {
  return {
    average: mean(days.map((day) => day[nutrient])),
    averageTarget: mean(days.map((day) => day.targets[nutrient])),
    daysOnTarget: days.filter((day) => onTarget(day[nutrient], day.targets[nutrient])).length,
  };
}

// Only days with known calorie and protein totals are compared. A day with a missing value would read as under target.
function nutrition(days: ReviewDay[]): Review["nutrition"] {
  const complete = days.flatMap(({ food, targets }): CompleteDay[] => isCompleteFood(food) ? [{ kcal: food.kcal, proteinG: food.proteinG, targets }] : []);

  return {
    completeDays: complete.length,
    kcal: compare(complete, "kcal", (value, target) => Math.abs(value - target) <= target * calorieTolerance),
    proteinG: compare(complete, "proteinG", (value, target) => value >= target),
  };
}

// The seven local days ending on `to`. A day without a record of a kind reads null for it, never zero.
export async function getReview(db: AppDatabase, userId: string, to: string): Promise<Review> {
  const from = shiftDate(to, 1 - reviewDays);

  const [food, workouts, sleep, weights, targetsOn] = await Promise.all([
    getFoodRange(db, userId, from, to),
    getWorkoutRange(db, userId, from, to),
    getSleepRange(db, userId, from, to),
    getWeightRange(db, userId, from, to),
    getDatedHistory(db, targetsKind, userId, to),
  ]);

  const days = Array.from({ length: reviewDays }, (_, index): ReviewDay => {
    const date = shiftDate(from, index);
    const workout = workouts.get(date);
    const night = sleep.get(date);
    const { kcal, proteinG } = targetsOn(date).targets;

    return {
      date,
      food: food.get(date) ?? { entryCount: 0, kcal: null, proteinG: null },
      workouts: { entryCount: workout?.entryCount ?? 0, totalMinutes: workout?.totalMinutes ?? null },
      sleep: { sessionCount: night?.sessionCount ?? 0, totalMinutes: night?.totalMinutes ?? null },
      weightKg: weights.get(date) ?? null,
      targets: { kcal, proteinG },
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
    nutrition: nutrition(days),
  };
}
