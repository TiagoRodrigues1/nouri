import { z } from "zod";
import { entrySchema, foodItemInputSchema, positiveAmount, recordedFoodSchema } from "../food/contract.js";
import type { RecordedFood } from "../food/contract.js";
import { occurredAtSchema, timeZoneSchema } from "../time.js";

export const maxMealItems = 20;

// A meal that logs itself every day at a local time, in the zone it was turned on in.
export const mealDailySchema = z.object({
  time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/),
  timeZone: timeZoneSchema,
}).strict();

export const savedMealSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  name: z.string(),
  // Each food as it was recorded, at the amount it was saved with. Logging scales it from there.
  items: z.array(z.object({ id: z.uuid(), food: recordedFoodSchema })),
  // Defaults to null so receipts kept from before daily meals still replay.
  daily: mealDailySchema.nullable().default(null),
});

// A meal as listed, with the latest day its kept logs are on, daily fills included. Null for a meal never logged, or
// logged only before meal logs existed.
export const listedMealSchema = savedMealSchema.extend({ lastLogged: z.iso.date().nullable() });

export const savedMealListSchema = z.object({ meals: z.array(listedMealSchema) });

const unique = (ids: string[]) => new Set(ids).size === ids.length;

const mealNameSchema = z.string().trim().min(1).max(80);

// Saved items by id, each with the amount to log this time.
const itemAmountsSchema = z.array(z.object({ id: z.uuid(), amount: positiveAmount.max(10_000) }).strict())
  .min(1).max(maxMealItems).refine((items) => unique(items.map((item) => item.id)), "Items must be unique");

// Where a meal's food comes from: a saved item kept at an amount (editing only), or any food item.
export const mealItemInputSchema = z.union([
  z.object({ id: z.uuid(), amount: positiveAmount.max(10_000) }).strict(),
  ...foodItemInputSchema.options,
]);

// The whole meal. Creating and editing send the same body, and an edit replaces the meal: a saved item left out
// is removed.
export const mealInputSchema = z.object({
  name: mealNameSchema,
  items: z.array(mealItemInputSchema).min(1).max(maxMealItems)
    .refine((items) => unique(items.flatMap((item) => ("id" in item ? [item.id] : []))), "Items must be unique"),
  // Required, since an edit replaces the meal: leaving it out must not turn a daily meal off.
  daily: mealDailySchema.nullable(),
}).strict();

// The items to log and their amounts this time; a saved item left out is not logged.
export const mealLogInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  items: itemAmountsSchema,
}).strict();

export const mealLogSchema = z.object({ entries: z.array(entrySchema) });

// One logging of a saved meal, named as the meal was then. Its entries carry its id.
export const mealLogRefSchema = z.object({ id: z.uuid(), name: z.string() });

export type SavedMeal = z.infer<typeof savedMealSchema>;

export type SavedMealItem = SavedMeal["items"][number];

export type ListedMeal = z.infer<typeof listedMealSchema>;

export type SavedMealList = z.infer<typeof savedMealListSchema>;

export type MealInput = z.infer<typeof mealInputSchema>;

export type MealLogInput = z.infer<typeof mealLogInputSchema>;

export type MealItemInput = z.infer<typeof mealItemInputSchema>;

export type MealDaily = z.infer<typeof mealDailySchema>;

// A saved item as stored. The basis is the food as recorded when the meal was saved, so every amount scales
// from it and edits never compound rounding. It stays on the server; meals saved before editing lack it.
export type StoredMealItem = SavedMealItem & { basis?: RecordedFood | undefined };

export type MealLog = z.infer<typeof mealLogSchema>;

export type MealLogRef = z.infer<typeof mealLogRefSchema>;
