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

// Catalog values retain the source's precision; journal writes round scaled portions to three decimals.
const catalogNutrient = z.number().nonnegative().nullable();

export const catalogNutrientsSchema = z.object({
  kcal: catalogNutrient,
  proteinG: catalogNutrient,
  carbsG: catalogNutrient,
  fatG: catalogNutrient,
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

// Where a recorded food's nutrients came from. "nouri" is a food someone added to Nouri (see community.ts).
export const foodProviders = ["ciqual", "usda-fdc", "portfir", "open-food-facts", "nouri"] as const;

export type FoodProvider = (typeof foodProviders)[number];

const recordedRefSchema = z.object({
  provider: z.enum(foodProviders),
  id: z.string().min(1),
  version: z.string().optional(),
}).strict();

const manualFoodSchema = z.object({
  name: z.string().trim().min(1).max(200),
  quantity: quantitySchema,
  nutrients: nutrientsSchema,
  catalogRef: recordedRefSchema.optional(),
}).strict();

const catalogFoodSchema = z.object({
  kind: z.literal("catalog"),
  ref: catalogRefSchema,
  quantity: z.object({ amount: positiveAmount.max(10_000), unit: z.literal("g") }).strict(),
}).strict();

// A typed food may name its source, but never Ciqual: a Ciqual food is sent by reference so the server measures it.
const unforged = (food: z.infer<typeof manualFoodSchema> | z.infer<typeof catalogFoodSchema>) =>
  !("catalogRef" in food && food.catalogRef?.provider === "ciqual");

// A food as a write sends it: typed or scanned with its nutrients, or a Ciqual food in grams. Logging and saving a
// meal both take it.
export const submittedFoodSchema = z.union([manualFoodSchema, catalogFoodSchema]).refine(unforged);

export const manualInputSchema = z.object({ occurredAt: occurredAtSchema, timeZone: timeZoneSchema, food: manualFoodSchema }).strict();

export const catalogInputSchema = z.object({ occurredAt: occurredAtSchema, timeZone: timeZoneSchema, food: catalogFoodSchema }).strict();

export const submissionSchema = z.union([manualInputSchema, catalogInputSchema]).refine((input) => unforged(input.food));

// Logging a saved entry again copies what was recorded, so it keeps working after the catalog it came from changes.
// An amount scales the recorded food; without one it is logged at the amount recorded.
export const repeatInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  amount: positiveAmount.max(10_000).optional(),
}).strict();

// A food as the journal recorded it. Repeats, recent foods and saved meals copy it rather than re-reading the catalog.
export const recordedFoodSchema = manualFoodSchema.extend({ catalogRef: recordedRefSchema.nullable() });

export const entrySchema = recordBaseSchema.extend({ food: recordedFoodSchema });

export const maxBatchFoods = 20;

// A food taken from elsewhere: a logged entry copied at an amount, or a food as logging submits it, so a Ciqual
// food is a reference the server measures. Logging several foods and saving a meal both take it.
export const foodItemInputSchema = z.union([
  z.object({ entryId: z.uuid(), amount: positiveAmount.max(10_000) }).strict(),
  z.object({ food: submittedFoodSchema }).strict(),
]);

// Several foods logged at one time.
export const foodBatchInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  items: z.array(foodItemInputSchema).min(1).max(maxBatchFoods),
}).strict();

export const foodBatchSchema = z.object({ entries: z.array(entrySchema) });

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

const attributionSchema = z.object({ provider: z.string(), label: z.string(), url: z.url() });

const catalogCandidateSchema = z.object({
  ref: catalogRefSchema,
  name: z.string(),
  language: z.enum(["fr", "en"]),
  kind: z.literal("generic"),
  basis: z.literal("per-100-g"),
  nutrients: catalogNutrientsSchema,
});

// EAN-8, UPC-A, EAN-13 and GTIN-14 end in a GS1 check digit, so a misread or mistyped code is caught before any lookup.
export function isBarcode(code: string): boolean {
  if (!/^(?:\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = code.split("").map(Number).reverse();
  const sum = digits.slice(1).reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);

  return (10 - (sum % 10)) % 10 === digits[0];
}

// A food as its label reads, as the journal can record it: `food` is 100 g or 100 ml of it, which scaleFood turns
// into any amount in the same unit. The serving, when the label gives one, is in that unit too. Community foods
// have this shape; a packaged product found by its barcode always has one.
export const labelFoodSchema = z.object({
  barcode: z.string().refine(isBarcode).nullable(),
  brand: z.string().nullable(),
  food: recordedFoodSchema,
  serving: z.object({ amount: positiveAmount, unit: z.enum(["g", "ml"]) }).nullable(),
});

export const packagedProductSchema = labelFoodSchema.extend({ barcode: z.string().refine(isBarcode) });

// A food someone added to Nouri, rather than one from a provider's catalog.
export function isUserAdded(food: RecordedFood): boolean {
  return food.catalogRef?.provider === "nouri";
}

const communityCandidateSchema = labelFoodSchema.extend({ kind: z.literal("community") });

// Ciqual foods and community foods in one list; a community food carries a "nouri" reference.
export const searchResultSchema = z.object({
  items: z.array(z.discriminatedUnion("kind", [catalogCandidateSchema, communityCandidateSchema])),
  attribution: z.array(attributionSchema),
});

// Per 100 g or ml, no label carries energy beyond pure fat or more than 100 of a macro.
export const per100Max = { kcal: 900, proteinG: 100, carbsG: 100, fatG: 100 } as const;

const per100Schema = z.object({
  kcal: amount.max(per100Max.kcal).nullable(),
  proteinG: amount.max(per100Max.proteinG).nullable(),
  carbsG: amount.max(per100Max.carbsG).nullable(),
  fatG: amount.max(per100Max.fatG).nullable(),
}).strict();

// A label someone typed, to add to Nouri's foods. Its serving is in the label's unit.
export const communityFoodInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  brand: z.string().trim().min(1).max(100).nullable(),
  barcode: z.string().refine(isBarcode).nullable(),
  unit: z.enum(["g", "ml"]),
  nutrientsPer100: per100Schema,
  serving: z.object({ amount: positiveAmount.max(10_000) }).strict().nullable(),
}).strict();

export const barcodeLookupSchema = z.object({ product: packagedProductSchema, attribution: z.array(attributionSchema) });

export type FoodInput = z.infer<typeof manualInputSchema>;

export type CatalogFoodInput = z.infer<typeof catalogInputSchema>;

export type FoodSubmission = z.infer<typeof submissionSchema>;

export type SubmittedFood = z.infer<typeof submittedFoodSchema>;

export type RepeatInput = z.infer<typeof repeatInputSchema>;

export type FoodItemInput = z.infer<typeof foodItemInputSchema>;

export type FoodBatchInput = z.infer<typeof foodBatchInputSchema>;

export type FoodBatch = z.infer<typeof foodBatchSchema>;

export type FoodEntry = z.infer<typeof entrySchema>;

export type RecordedFood = z.infer<typeof recordedFoodSchema>;

export type RecentFoods = z.infer<typeof recentFoodsSchema>;

export type RecentFood = RecentFoods["foods"][number];

export type FoodDay = z.infer<typeof daySchema>;

export type SearchResult = z.infer<typeof searchResultSchema>;

export type PackagedProduct = z.infer<typeof packagedProductSchema>;

export type BarcodeLookup = z.infer<typeof barcodeLookupSchema>;

export type LabelFood = z.infer<typeof labelFoodSchema>;

export type CommunityCandidate = z.infer<typeof communityCandidateSchema>;

export type CommunityFoodInput = z.infer<typeof communityFoodInputSchema>;

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

// The foods' totals, rounded to the thousandth the journal stores. A nutrient is known only when every food has
// it, and unknown for no foods. A day's totals and a meal's both come from this.
export function totalNutrients(foods: Array<RecordedFood["nutrients"]>): RecordedFood["nutrients"] {
  const total = (pick: (nutrients: RecordedFood["nutrients"]) => number | null): number | null => {
    if (foods.length === 0) return null;
    let sum = 0;

    for (const nutrients of foods) {
      const value = pick(nutrients);

      if (value === null) return null;
      sum += value;
    }

    return Math.round(sum * 1000) / 1000;
  };

  return { kcal: total((n) => n.kcal), proteinG: total((n) => n.proteinG), carbsG: total((n) => n.carbsG), fatG: total((n) => n.fatG) };
}

// A recorded food as a manual write sends it: the body leaves out a reference it lacks rather than sending null.
export function manualFood({ catalogRef, ...food }: RecordedFood): FoodInput["food"] {
  return catalogRef ? { ...food, catalogRef } : food;
}

// A food as a manual write sends it, as the journal records it: a reference it lacks is null.
export function recordedFood(food: FoodInput["food"]): RecordedFood {
  return { ...food, catalogRef: food.catalogRef ?? null };
}

// A scaled food must still fit the journal's limits, which a tiny recorded amount scaled up can exceed.
export function scaledFood(food: RecordedFood, amount: number): RecordedFood | null {
  const result = recordedFoodSchema.safeParse(scaleFood(food, amount));

  return result.success ? result.data : null;
}
