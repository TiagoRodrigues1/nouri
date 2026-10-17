import { totalNutrients } from "../../../src/food/contract.js";
import { rowFood, type FoodRow } from "./saved-meals.js";

// Foods ticked in the Recent and Search lists. A row's key names where it was ticked, so ticking it again, from
// either list, unticks it.
export type FoodSelection = { has: (key: string) => boolean; toggle: (row: FoodRow) => void };

// A selection over a list of rows: ticking adds a row, unticking removes it. The owner decides what adding and
// removing do, such as refusing past a limit or animating the row out.
export function rowSelection(rows: Array<{ key: string }>, add: (row: FoodRow) => void, remove: (key: string) => void): FoodSelection {
  const has = (key: string) => rows.some((row) => row.key === key);

  return { has, toggle: (row) => (has(row.key) ? remove(row.key) : add(row)) };
}

// Energy of the rows at their typed amounts; null when any lacks a value.
export function rowsKcal(rows: FoodRow[]): number | null {
  return totalNutrients(rows.map((row) => rowFood(row).nutrients)).kcal;
}
