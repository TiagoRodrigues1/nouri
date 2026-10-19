import { coach } from "../coaching/coaching.js";
import type { AppDatabase } from "../db/database.js";
import { getDatedHistory } from "../effective-dated.js";
import { getFoodRange } from "../food/food.js";
import { getWeightRange } from "../measurements/measurements.js";
import { getSleepRange } from "../sleep/sleep.js";
import { getSupplementRange } from "../supplements/supplements.js";
import { shiftDate } from "../time.js";
import { targetsKind } from "../targets/targets.js";
import { getWaterRange } from "../water/water.js";
import { getWorkoutRange } from "../workouts/workouts.js";
import { calorieTolerance, defaultReviewDays, isCompleteFood, weekLength } from "./contract.js";
import type { Review, ReviewDay, ReviewPeriod, ReviewRange } from "./contract.js";

type Measured = { value: number; target: number };

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compare(measured: Measured[], onTarget: (value: number, target: number) => boolean): ReviewPeriod["water"] {
  return {
    average: mean(measured.map(({ value }) => value)),
    averageTarget: mean(measured.map(({ target }) => target)),
    daysOnTarget: measured.filter(({ value, target }) => onTarget(value, target)).length,
  };
}

const withinTolerance = (value: number, target: number) => Math.abs(value - target) <= target * calorieTolerance;

const reached = (value: number, target: number) => value >= target;

// Only days with known calorie and protein totals are compared. A day with a missing value would read as under target.
function nutrition(days: ReviewDay[]): ReviewPeriod["nutrition"] {
  const complete = days.flatMap(({ food, targets }) => isCompleteFood(food) ? [{ food, targets }] : []);

  return {
    completeDays: complete.length,
    kcal: compare(complete.map(({ food, targets }) => ({ value: food.kcal, target: targets.kcal })), withinTolerance),
    proteinG: compare(complete.map(({ food, targets }) => ({ value: food.proteinG, target: targets.proteinG })), reached),
  };
}

const recorded = {
  food: (day: ReviewDay) => day.food.entryCount > 0,
  water: (day: ReviewDay) => day.water.entryCount > 0,
  supplements: (day: ReviewDay) => day.supplements.intakeCount > 0,
  workouts: (day: ReviewDay) => day.workouts.entryCount > 0,
  sleep: (day: ReviewDay) => day.sleep.sessionCount > 0,
  weight: (day: ReviewDay) => day.weightKg !== null,
};

// What a run of days adds up to; the range and each week go through the same rules.
function summarize(days: ReviewDay[]): ReviewPeriod {
  const first = days[0];
  const last = days.at(-1);

  if (!first || !last) throw new Error("A review period needs at least one day");

  const counted = (kind: (day: ReviewDay) => boolean) => days.filter(kind).length;
  const dueDays = days.filter(({ supplements }) => supplements.due > 0);

  return {
    from: first.date,
    to: last.date,
    recordedDays: {
      food: counted(recorded.food),
      water: counted(recorded.water),
      supplements: counted(recorded.supplements),
      workouts: counted(recorded.workouts),
      sleep: counted(recorded.sleep),
      weight: counted(recorded.weight),
      any: counted((day) => Object.values(recorded).some((kind) => kind(day))),
    },
    nutrition: nutrition(days),
    water: compare(days.flatMap(({ water, targets }) => water.totalMl === null ? [] : [{ value: water.totalMl, target: targets.waterMl }]), reached),
    sleep: compare(days.flatMap(({ sleep, targets }) => sleep.totalMinutes === null ? [] : [{ value: sleep.totalMinutes, target: targets.sleepMinutes }]), reached),
    supplements: {
      dueDays: dueDays.length,
      fullDays: dueDays.filter(({ supplements }) => supplements.taken === supplements.due).length,
    },
    workouts: {
      count: days.reduce((sum, day) => sum + day.workouts.entryCount, 0),
      totalMinutes: days.reduce((sum, day) => sum + (day.workouts.totalMinutes ?? 0), 0),
    },
    weightKg: mean(days.flatMap(({ weightKg }) => weightKg === null ? [] : [weightKg])),
  };
}

// Whole weeks ending on the last day, oldest first. Leftover days at the start belong to no week.
function weeks(days: ReviewDay[]): ReviewPeriod[] {
  const whole = days.slice(days.length % weekLength);

  return Array.from({ length: whole.length / weekLength }, (_, index) => summarize(whole.slice(index * weekLength, (index + 1) * weekLength)));
}

// The local days ending on `to`, a week by default. A day without a record of a kind reads null for it, never zero.
export async function getReview(db: AppDatabase, userId: string, to: string, length: ReviewRange = defaultReviewDays): Promise<Review> {
  const from = shiftDate(to, 1 - length);

  const [food, water, supplements, workouts, sleep, weights, targetsOn] = await Promise.all([
    getFoodRange(db, userId, from, to),
    getWaterRange(db, userId, from, to),
    getSupplementRange(db, userId, from, to),
    getWorkoutRange(db, userId, from, to),
    getSleepRange(db, userId, from, to),
    getWeightRange(db, userId, from, to),
    getDatedHistory(db, targetsKind, userId, to),
  ]);

  const days = Array.from({ length }, (_, index): ReviewDay => {
    const date = shiftDate(from, index);
    const drink = water.get(date);
    const workout = workouts.get(date);
    const night = sleep.get(date);
    const { kcal, proteinG, waterMl, sleepMinutes } = targetsOn(date).targets;

    return {
      date,
      food: food.get(date) ?? { entryCount: 0, kcal: null, proteinG: null },
      water: { entryCount: drink?.entryCount ?? 0, totalMl: drink?.totalMl ?? null },
      supplements: supplements.get(date) ?? { intakeCount: 0, taken: 0, due: 0 },
      workouts: { entryCount: workout?.entryCount ?? 0, totalMinutes: workout?.totalMinutes ?? null },
      sleep: { sessionCount: night?.sessionCount ?? 0, totalMinutes: night?.totalMinutes ?? null },
      weightKg: weights.get(date) ?? null,
      targets: { kcal, proteinG, waterMl, sleepMinutes },
    };
  });

  const byWeek = weeks(days);
  const lastWeek = byWeek.at(-1);

  return {
    ...summarize(days),
    days,
    weeks: byWeek,
    suggestions: lastWeek ? coach(lastWeek) : [],
  };
}
