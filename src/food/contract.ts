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
export const repeatInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
}).strict();

export const entrySchema = recordBaseSchema.extend({
  food: manualInputSchema.shape.food.extend({ catalogRef: recordedRefSchema.nullable() }),
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

export type FoodDay = z.infer<typeof daySchema>;

export type SearchResult = z.infer<typeof searchResultSchema>;

export type CatalogSelection = z.infer<typeof catalogRefSchema>;
