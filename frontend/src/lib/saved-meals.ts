import { scaleFood, totalNutrients, type FoodEntry, type RecordedFood, type SubmittedFood } from "../../../src/food/contract.js";
import { maxMealItems, type MealItemInput, type SavedMeal } from "../../../src/meals/contract.js";
import { typedAmount } from "./typed-amount.js";
import { portionFood, sourceOf } from "./food-portion.js";

export { maxMealItems };

// A food at some amount, which previews any other. The amount stays text while typing, so a half-typed "0." is
// not rewritten under the cursor. Logging a meal and editing one both list rows like this.
type AmountRow = { food: RecordedFood; amount: string };

// A row's food at its typed amount, so the page shows what logging or saving it would record.
export function rowFood(row: AmountRow): RecordedFood {
  const amount = typedAmount(row.amount);

  return amount === null ? row.food : scaleFood(row.food, amount);
}

// One saved item offered for logging, ticked to include it.
export type MealRow = AmountRow & { id: string; included: boolean };

export function mealRows(items: Array<{ id: string; food: RecordedFood }>): MealRow[] {
  return items.map(({ id, food }) => ({ id, food, included: true, amount: String(food.quantity.amount) }));
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

// Energy of the included rows; null when nothing is included or any of them lacks a value.
export function includedKcal(rows: MealRow[]): number | null {
  return totalNutrients(rows.flatMap((row) => (row.included ? [rowFood(row).nutrients] : []))).kcal;
}

// Where a food in the meal editor came from, which decides what the server is sent: a saved item by id, a logged
// food by entry, or a food as logging submits it (a Ciqual reference, or a typed or scanned label).
export type DraftSource =
  | { kind: "saved"; id: string }
  | { kind: "entry"; entryId: string }
  | { kind: "submitted"; food: SubmittedFood };

// One food in the meal being edited.
export type DraftRow = AmountRow & { key: string; source: DraftSource };

export function draftRow(source: DraftSource, food: RecordedFood, amount = food.quantity.amount): DraftRow {
  return { key: crypto.randomUUID(), source, food, amount: String(amount) };
}

export function savedRows(meal: SavedMeal): DraftRow[] {
  return meal.items.map((item) => draftRow({ kind: "saved", id: item.id }, item.food));
}

export function entryRows(entries: FoodEntry[]): DraftRow[] {
  return entries.map((entry) => draftRow({ kind: "entry", entryId: entry.id }, entry.food));
}

// The items to send; null while a row has no usable amount.
export function draftItems(rows: DraftRow[]): MealItemInput[] | null {
  const items: MealItemInput[] = [];

  for (const row of rows) {
    const amount = typedAmount(row.amount);

    if (amount === null) return null;
    const { source } = row;

    if (source.kind === "saved") items.push({ id: source.id, amount });
    else if (source.kind === "entry") items.push({ entryId: source.entryId, amount });
    else {
      items.push({ food: portionFood(sourceOf(source.food, row.food), amount).submitted });
    }
  }

  return items;
}
