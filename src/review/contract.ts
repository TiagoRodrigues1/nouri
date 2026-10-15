import { z } from "zod";

// The windows a review can cover, in days. A week unless the request asks for another.
export const reviewRanges = [7, 14, 30, 90] as const;

export const defaultReviewDays = 7;

export const reviewRangeSchema = z.coerce.number().pipe(z.union(reviewRanges.map((days) => z.literal(days))));

export type ReviewRange = (typeof reviewRanges)[number];

// A day's calories count as on target within this share of its target. Protein counts once it reaches its target.
export const calorieTolerance = 0.1;

// A metric is null when nothing was recorded that day, never zero.
export const reviewDaySchema = z.object({
  date: z.iso.date(),
  food: z.object({
    entryCount: z.number().int(),
    // Null when no food was logged, or when a logged food lacks the value.
    kcal: z.number().nullable(),
    proteinG: z.number().nullable(),
  }),
  workouts: z.object({ entryCount: z.number().int(), totalMinutes: z.number().int().nullable() }),
  // Nights count toward the day they end on.
  sleep: z.object({ sessionCount: z.number().int(), totalMinutes: z.number().int().nullable() }),
  // The last weight recorded that day. Earlier weights do not carry forward.
  weightKg: z.number().nullable(),
  // The targets in force that day, so a change mid-week judges each day by its own.
  targets: z.object({ kcal: z.number().int(), proteinG: z.number().int() }),
});

// Measured over complete food days only; the averages are null when there are none.
const targetComparisonSchema = z.object({
  average: z.number().nullable(),
  // The mean of each complete day's target.
  averageTarget: z.number().nullable(),
  daysOnTarget: z.number().int(),
});

export const reviewSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  // Oldest first, one per local day from `from` to `to`.
  days: z.array(reviewDaySchema).min(defaultReviewDays).max(Math.max(...reviewRanges)),
  // How many of the days have at least one record of each kind, and of any kind.
  recordedDays: z.object({
    food: z.number().int(),
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
});

export type ReviewDay = z.infer<typeof reviewDaySchema>;

type CompleteFood = ReviewDay["food"] & { kcal: number; proteinG: number };

// A day with no food has no totals, so known totals also mean food was logged.
export function isCompleteFood(food: ReviewDay["food"]): food is CompleteFood {
  return food.kcal !== null && food.proteinG !== null;
}

export type Review = z.infer<typeof reviewSchema>;
