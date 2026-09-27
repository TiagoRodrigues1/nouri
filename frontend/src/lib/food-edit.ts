import { catalogRefSchema, submissionSchema, type FoodEntry, type FoodSubmission } from "../../../src/food/contract.js";
import { entryTime, occurredAt, timeZone } from "./time.js";

type Nutrients = FoodEntry["food"]["nutrients"];

export type NutrientText = Record<keyof Nutrients, string>;

// Form fields as typed; an empty nutrient means the value is unknown.
export type FoodDraft = { time: string; amount: string; name: string; nutrients: NutrientText };

export const nutrientFields = [
  ["kcal", "Calories (kcal)"],
  ["proteinG", "Protein (g)"],
  ["carbsG", "Carbs (g)"],
  ["fatG", "Fat (g)"],
] as const;

// Older saved Ciqual references may lack a version. They cannot be used for a catalog edit,
// so the entry edits as manual food, and only a non-Ciqual reference is kept.
export function editableRef(entry: FoodEntry) {
  const ref = entry.food.catalogRef;
  const catalog = catalogRefSchema.safeParse(ref);

  return { catalog: catalog.success ? catalog.data : null, manual: ref?.provider === "ciqual" ? null : ref };
}

function mapNutrients<T, U>(values: Record<keyof Nutrients, T>, map: (value: T) => U): Record<keyof Nutrients, U> {
  // SAFETY: nutrientFields lists every key of Nutrients exactly once.
  return Object.fromEntries(nutrientFields.map(([key]) => [key, map(values[key])])) as Record<keyof Nutrients, U>;
}

export function draftFor(entry: FoodEntry): FoodDraft {
  const text = (value: number | null) => (value === null ? "" : String(value));

  return {
    time: entryTime(entry),
    amount: String(entry.food.quantity.amount),
    name: entry.food.name,
    nutrients: mapNutrients(entry.food.nutrients, text),
  };
}

// Nutrients were entered for an amount, so a new amount scales them. Unknown values stay unknown.
export function scaleNutrients(nutrients: NutrientText, from: number, to: number): NutrientText {
  const scale = (value: string) => (value.trim() === "" ? value : String(Math.round((Number(value) * to * 1000) / from) / 1000));

  return mapNutrients(nutrients, scale);
}

// A catalog entry sends its reference and grams, and the server recalculates its nutrients.
// An unchanged time keeps the recorded instant and zone. A new time is read on the entry's own
// local date in this browser's zone, so an edit never moves the entry to another day.
export function editedSubmission(entry: FoodEntry, draft: FoodDraft): FoodSubmission {
  const when = draft.time === entryTime(entry)
    ? { occurredAt: entry.occurredAt, timeZone: entry.timeZone }
    : { occurredAt: occurredAt(entry.localDate, draft.time), timeZone };

  const amount = Number(draft.amount);
  const { catalog: ref, manual } = editableRef(entry);

  if (ref) return submissionSchema.parse({ ...when, food: { kind: "catalog", ref, quantity: { amount, unit: "g" } } });

  const value = (text: string) => (text.trim() === "" ? null : Number(text));

  const food = {
    name: draft.name.trim(),
    quantity: { ...entry.food.quantity, amount },
    nutrients: mapNutrients(draft.nutrients, value),
  };

  return submissionSchema.parse({ ...when, food: manual ? { ...food, catalogRef: manual } : food });
}
