import type { RecordedFood } from "./contract.js";

type Nutrients = RecordedFood["nutrients"];

// Food tables keep each nutrient as integer thousandths in these columns; null is an unknown value.
type StoredNutrients = { kcalMilli: number | null; proteinMilli: number | null; carbsMilli: number | null; fatMilli: number | null };

export function milli(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000);
}

function decimal(value: number | null): number | null {
  return value === null ? null : value / 1000;
}

export function storedNutrients({ kcal, proteinG, carbsG, fatG }: Nutrients): StoredNutrients {
  return { kcalMilli: milli(kcal), proteinMilli: milli(proteinG), carbsMilli: milli(carbsG), fatMilli: milli(fatG) };
}

export function nutrientsOf(row: StoredNutrients): Nutrients {
  return { kcal: decimal(row.kcalMilli), proteinG: decimal(row.proteinMilli), carbsG: decimal(row.carbsMilli), fatG: decimal(row.fatMilli) };
}
