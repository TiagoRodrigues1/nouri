import { maxBatchFoods, totalNutrients, type FoodBatchInput } from "../../../src/food/contract.js";
import { draftItems, rowFood, type DraftRow } from "./saved-meals.js";

export { maxBatchFoods };

// Foods ticked in the log dialog's Recent and Search lists. A row's key names where it was ticked, so ticking it
// again, from either list, unticks it.
export type FoodSelection = { has: (key: string) => boolean; toggle: (key: string, row: DraftRow) => void };

// The items to send; null while a row has no usable amount. Rows come from recent entries or submitted foods.
export function batchItems(rows: DraftRow[]): FoodBatchInput["items"] | null {
  return draftItems(rows)?.flatMap((item) => ("id" in item ? [] : [item])) ?? null;
}

// Energy of the rows at their typed amounts; null when any lacks a value.
export function rowsKcal(rows: DraftRow[]): number | null {
  return totalNutrients(rows.map((row) => rowFood(row).nutrients)).kcal;
}
