import { z } from "zod";
import { suggestionSchema } from "../coaching/contract.js";

// The windows a review can cover, in days. A week unless the request asks for another.
export const reviewRanges = [7, 14, 30, 90] as const;

export const defaultReviewDays = 7;

export const reviewRangeSchema = z.coerce.number().pipe(z.union(reviewRanges.map((days) => z.literal(days))));

export type ReviewRange = (typeof reviewRanges)[number];

// A day's calories count as on target within this share of its target. Protein counts once it reaches its target.
export const calorieTolerance = 0.1;

// Weekly trends split the range into weeks of this many days, ending on its last day.
export const weekLength = 7;

// A metric is null when nothing was recorded that day, never zero.
export const reviewDaySchema = z.object({
  date: z.iso.date(),
  food: z.object({
    entryCount: z.number().int(),
    // Null when no food was logged, or when a logged food lacks the value.
    kcal: z.number().nullable(),
    proteinG: z.number().nullable(),
  }),
  water: z.object({ entryCount: z.number().int(), totalMl: z.number().int().nullable() }),
  // `due` counts the supplements on that day's stack scheduled for it, and `taken` those of them with every dose in;
  // `intakeCount` counts every intake, including off-day ones and ones since removed.
  supplements: z.object({ intakeCount: z.number().int(), taken: z.number().int(), due: z.number().int() }),
  workouts: z.object({ entryCount: z.number().int(), totalMinutes: z.number().int().nullable() }),
  // Nights count toward the day they end on.
  sleep: z.object({ sessionCount: z.number().int(), totalMinutes: z.number().int().nullable() }),
  // The last weight recorded that day. Earlier weights do not carry forward.
  weightKg: z.number().nullable(),
  // The targets in force that day, so a change mid-week judges each day by its own.
  targets: z.object({ kcal: z.number().int(), proteinG: z.number().int(), waterMl: z.number().int(), sleepMinutes: z.number().int() }),
});

// Measured over the days with a value only; the averages are null when there are none.
const targetComparisonSchema = z.object({
  average: z.number().nullable(),
  // The mean of those days' targets.
  averageTarget: z.number().nullable(),
  daysOnTarget: z.number().int(),
});

// What a run of days adds up to. The whole range and each of its weeks share this shape.
export const reviewPeriodSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  // How many of the days have at least one record of each kind, and of any kind.
  recordedDays: z.object({
    food: z.number().int(),
    water: z.number().int(),
    supplements: z.number().int(),
    workouts: z.number().int(),
    sleep: z.number().int(),
    weight: z.number().int(),
    any: z.number().int(),
  }),
  // A complete food day has food logged and known calorie and protein totals. Only those are compared with targets.
  nutrition: z.object({
    completeDays: z.number().int(),
    kcal: targetComparisonSchema,
    proteinG: targetComparisonSchema,
  }),
  // Over days with water logged; a day is on target once it reaches its target.
  water: targetComparisonSchema,
  // Over nights recorded; a night is on target once it reaches its target.
  sleep: targetComparisonSchema,
  // Days with a supplement due, and how many of them had every due dose taken.
  supplements: z.object({ dueDays: z.number().int(), fullDays: z.number().int() }),
  workouts: z.object({ count: z.number().int(), totalMinutes: z.number().int() }),
  // The mean of the weighed days; null when none were weighed.
  weightKg: z.number().nullable(),
});

export const reviewSchema = reviewPeriodSchema.extend({
  // Oldest first, one per local day from `from` to `to`.
  days: z.array(reviewDaySchema).min(defaultReviewDays).max(Math.max(...reviewRanges)),
  // Whole weeks ending on `to`, oldest first. Days before the oldest whole week are left out.
  weeks: z.array(reviewPeriodSchema).min(1),
  // Drawn from the last week only, most important first.
  suggestions: z.array(suggestionSchema),
});

export type ReviewDay = z.infer<typeof reviewDaySchema>;

type CompleteFood = ReviewDay["food"] & { kcal: number; proteinG: number };

// A day with no food has no totals, so known totals also mean food was logged.
export function isCompleteFood(food: ReviewDay["food"]): food is CompleteFood {
  return food.kcal !== null && food.proteinG !== null;
}

export type ReviewPeriod = z.infer<typeof reviewPeriodSchema>;

export type Review = z.infer<typeof reviewSchema>;
