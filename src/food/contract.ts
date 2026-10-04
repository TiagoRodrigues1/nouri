import { z } from "zod";
import { recordBaseSchema } from "../journal/contract.js";
import { occurredAtSchema, timeZoneSchema } from "../time.js";

const amount = z.number().nonnegative().max(1_000_000)
  .refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7);

export const positiveAmount = amount.positive();

export const nutrientsSchema = z.object({
  kcal: amount.nullable(),
  proteinG: amount.nullable(),
  carbsG: amount.nullable(),
  fatG: amount.nullable(),
}).strict();

const quantitySchema = z.union([
  z.object({ amount: positiveAmount, unit: z.enum(["g", "ml"]) }).strict(),
  z.object({ amount: positiveAmount, unit: z.literal("serving"), servingSize: z.object({ amount: positiveAmount, unit: z.enum(["g", "ml"]) }).strict() }).strict(),
]);

export const catalogRefSchema = z.object({
  provider: z.literal("ciqual"),
  id: z.string().min(1),
  version: z.string().min(1),
}).strict();

const recordedRefSchema = z.object({
  provider: z.enum(["ciqual", "usda-fdc", "portfir", "open-food-facts"]),
  id: z.string().min(1),
  version: z.string().optional(),
}).strict();

export const manualInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  food: z.object({
    name: z.string().trim().min(1).max(200),
    quantity: quantitySchema,
    nutrients: nutrientsSchema,
    catalogRef: recordedRefSchema.optional(),
  }).strict(),
}).strict();

export const catalogInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  food: z.object({
    kind: z.literal("catalog"),
    ref: catalogRefSchema,
    quantity: z.object({ amount: positiveAmount.max(10_000), unit: z.literal("g") }).strict(),
  }).strict(),
}).strict();

export const submissionSchema = z.union([manualInputSchema, catalogInputSchema]).refine((input) =>
  !("catalogRef" in input.food && input.food.catalogRef?.provider === "ciqual"));

// Logging a saved entry again copies what was recorded, so it keeps working after the catalog it came from changes.
// An amount scales the recorded food; without one it is logged at the amount recorded.
export const repeatInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  amount: positiveAmount.max(10_000).optional(),
}).strict();

// A food as the journal recorded it. Repeats, recent foods and saved meals copy it rather than re-reading the catalog.
export const recordedFoodSchema = manualInputSchema.shape.food.extend({ catalogRef: recordedRefSchema.nullable() });

export const entrySchema = recordBaseSchema.extend({ food: recordedFoodSchema });

// Distinct foods most recently eaten first, each with the latest entry that recorded it.
export const recentFoodsSchema = z.object({
  foods: z.array(z.object({ entryId: z.uuid(), lastEaten: z.iso.date(), food: recordedFoodSchema })),
});

export const daySchema = z.object({
  date: z.iso.date(),
  food: z.object({
    entries: z.array(entrySchema),
    entryCount: z.number().int(),
    totals: nutrientsSchema,
  }),
});

export const searchResultSchema = z.object({
  items: z.array(z.object({
    ref: catalogRefSchema,
    name: z.string(),
    language: z.enum(["fr", "en"]),
    kind: z.literal("generic"),
    basis: z.literal("per-100-g"),
    nutrients: nutrientsSchema,
  })),
  attribution: z.array(z.object({ provider: z.string(), label: z.string(), url: z.url() })),
});

export type FoodInput = z.infer<typeof manualInputSchema>;

export type CatalogFoodInput = z.infer<typeof catalogInputSchema>;

export type FoodSubmission = z.infer<typeof submissionSchema>;

export type RepeatInput = z.infer<typeof repeatInputSchema>;

export type FoodEntry = z.infer<typeof entrySchema>;

export type RecordedFood = z.infer<typeof recordedFoodSchema>;

export type RecentFoods = z.infer<typeof recentFoodsSchema>;

export type RecentFood = RecentFoods["foods"][number];

export type FoodDay = z.infer<typeof daySchema>;

export type SearchResult = z.infer<typeof searchResultSchema>;

export type CatalogSelection = z.infer<typeof catalogRefSchema>;

export type FoodQuantity = z.infer<typeof quantitySchema>;

// The same food at another amount. Nutrients scale with it, rounded to the thousandth the journal stores,
// and an unknown value stays unknown. The server logs with this and the page previews with it.
export function scaleFood(food: RecordedFood, amount: number): RecordedFood {
  const from = food.quantity.amount;
  const scale = (value: number | null) => (value === null ? null : Math.round((value * amount * 1000) / from) / 1000);
  const { kcal, proteinG, carbsG, fatG } = food.nutrients;

  return {
    ...food,
    quantity: { ...food.quantity, amount },
    nutrients: { kcal: scale(kcal), proteinG: scale(proteinG), carbsG: scale(carbsG), fatG: scale(fatG) },
  };
}

// A scaled food must still fit the journal's limits, which a tiny recorded amount scaled up can exceed.
export function scaledFood(food: RecordedFood, amount: number): RecordedFood | null {
  const result = recordedFoodSchema.safeParse(scaleFood(food, amount));

  return result.success ? result.data : null;
}
