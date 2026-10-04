import { scaleFood, type RecordedFood } from "../../../src/food/contract.js";
import { maxMealItems } from "../../../src/meals/contract.js";
import { typedAmount } from "./typed-amount.js";

export { maxMealItems };

// One food offered for a meal, whether an entry being saved or a saved item being logged.
// The amount stays text while typing, so a half-typed "0." is not rewritten under the cursor.
export type MealRow = { id: string; food: RecordedFood; included: boolean; amount: string };

export function mealRows(items: Array<{ id: string; food: RecordedFood }>, included: (id: string) => boolean = () => true): MealRow[] {
  return items.map(({ id, food }) => ({ id, food, included: included(id), amount: String(food.quantity.amount) }));
}

// The rows to send, each with its amount; null while an included row has no usable amount.
export function chosenAmounts(rows: MealRow[]): Array<{ id: string; amount: number }> | null {
  const chosen = [];

  for (const row of rows) {
    if (!row.included) continue;
    const amount = typedAmount(row.amount);

    if (amount === null) return null;
    chosen.push({ id: row.id, amount });
  }

  return chosen;
}

// A row's food at its typed amount, so the page shows what logging it would record.
export function rowFood(row: MealRow): RecordedFood {
  const amount = typedAmount(row.amount);

  return amount === null ? row.food : scaleFood(row.food, amount);
}

// Energy of the included rows; null when nothing is included or any of them lacks a value.
export function includedKcal(rows: MealRow[]): number | null {
  let total = 0;
  let any = false;

  for (const row of rows) {
    if (!row.included) continue;
    const { kcal } = rowFood(row).nutrients;

    if (kcal === null) return null;
    total += kcal;
    any = true;
  }

  return any ? total : null;
}
