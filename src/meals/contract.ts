import { z } from "zod";
import { entrySchema, positiveAmount } from "../food/contract.js";
import { occurredAtSchema, timeZoneSchema } from "../time.js";

export const maxMealItems = 20;

// A food as it was recorded, at the amount it was saved with. Logging scales it from there.
export const mealFoodSchema = entrySchema.shape.food;

export const savedMealSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  name: z.string(),
  items: z.array(z.object({ id: z.uuid(), food: mealFoodSchema })),
});

export const savedMealListSchema = z.object({ meals: z.array(savedMealSchema) });

const unique = (ids: string[]) => new Set(ids).size === ids.length;

// A meal is saved from logged entries, so the server copies the foods and the client never sends nutrients.
export const mealInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  items: z.array(z.object({ entryId: z.uuid(), amount: positiveAmount.max(10_000) }).strict())
    .min(1).max(maxMealItems).refine((items) => unique(items.map((item) => item.entryId)), "Entries must be unique"),
}).strict();

// The items to log and their amounts this time; a saved item left out is not logged.
export const mealLogInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  items: z.array(z.object({ id: z.uuid(), amount: positiveAmount.max(10_000) }).strict())
    .min(1).max(maxMealItems).refine((items) => unique(items.map((item) => item.id)), "Items must be unique"),
}).strict();

export const mealLogSchema = z.object({ entries: z.array(entrySchema) });

export type MealFood = z.infer<typeof mealFoodSchema>;

export type SavedMeal = z.infer<typeof savedMealSchema>;

export type SavedMealItem = SavedMeal["items"][number];

export type SavedMealList = z.infer<typeof savedMealListSchema>;

export type MealInput = z.infer<typeof mealInputSchema>;

export type MealLogInput = z.infer<typeof mealLogInputSchema>;

export type MealLog = z.infer<typeof mealLogSchema>;

// The same food at another amount. Nutrients scale with it, rounded to the thousandth the journal stores,
// and an unknown value stays unknown. The server logs with this and the page previews with it.
export function scaleFood(food: MealFood, amount: number): MealFood {
  const from = food.quantity.amount;
  const scale = (value: number | null) => (value === null ? null : Math.round((value * amount * 1000) / from) / 1000);
  const { kcal, proteinG, carbsG, fatG } = food.nutrients;

  return {
    ...food,
    quantity: { ...food.quantity, amount },
    nutrients: { kcal: scale(kcal), proteinG: scale(proteinG), carbsG: scale(carbsG), fatG: scale(fatG) },
  };
}
