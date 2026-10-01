import { z } from "zod";

export const reviewDays = 7;

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
});

export const reviewSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  // Oldest first, one per local day from `from` to `to`.
  days: z.array(reviewDaySchema).length(reviewDays),
  // How many of the days have at least one record of each kind, and of any kind.
  recordedDays: z.object({
    food: z.number().int(),
    workouts: z.number().int(),
    sleep: z.number().int(),
    weight: z.number().int(),
    any: z.number().int(),
  }),
});

export type ReviewDay = z.infer<typeof reviewDaySchema>;

export type Review = z.infer<typeof reviewSchema>;
