import { scaleFood, type FoodEntry, type FoodItemInput, type RecordedFood, type SubmittedFood } from "../../../src/food/contract.js";
import { everyDay, maxMealItems, type MealItemInput, type SavedMeal } from "../../../src/meals/contract.js";
import { typedAmount } from "./typed-amount.js";
import { portionFood, sourceOf } from "./food-portion.js";

export { everyDay, maxMealItems };

// A food at some amount, which previews any other. The amount stays text while typing, so a half-typed "0." is
// not rewritten under the cursor. Logging a meal and editing one both list rows like this.
type AmountRow = { food: RecordedFood; amount: string };

// A row's food at its typed amount, so the page shows what logging or saving it would record.
export function rowFood(row: AmountRow): RecordedFood {
  const amount = typedAmount(row.amount);

  return amount === null ? row.food : scaleFood(row.food, amount);
}

// Where a ticked food came from, which decides what the server is sent: a logged food by entry, or a food as
// logging submits it (a Ciqual reference, or a typed or scanned label).
export type FoodSource =
  | { kind: "entry"; entryId: string }
  | { kind: "submitted"; food: SubmittedFood };

// Where a food in the meal editor came from: a saved item by id, or any ticked food.
export type DraftSource = { kind: "saved"; id: string } | FoodSource;

type Row<S> = AmountRow & { key: string; source: S };

// One ticked food, in the log dialog's selection or added to a meal.
export type FoodRow = Row<FoodSource>;

// One food in the meal being edited.
export type DraftRow = Row<DraftSource>;

export function draftRow<S extends DraftSource>(source: S, food: RecordedFood, amount = food.quantity.amount): Row<S> {
  return { key: crypto.randomUUID(), source, food, amount: String(amount) };
}

export function savedRows(meal: SavedMeal): DraftRow[] {
  return meal.items.map((item) => draftRow({ kind: "saved", id: item.id }, item.food));
}

export function entryRows(entries: FoodEntry[]): DraftRow[] {
  return entries.map((entry) => draftRow({ kind: "entry", entryId: entry.id }, entry.food));
}

// Each row's item at its typed amount; null while a row has no usable amount.
function rowItems<R extends AmountRow, T>(rows: R[], item: (row: R, amount: number) => T): T[] | null {
  const items: T[] = [];

  for (const row of rows) {
    const amount = typedAmount(row.amount);

    if (amount === null) return null;
    items.push(item(row, amount));
  }

  return items;
}

function foodItem(source: FoodSource, food: RecordedFood, amount: number): FoodItemInput {
  return source.kind === "entry" ? { entryId: source.entryId, amount } : { food: portionFood(sourceOf(source.food, food), amount).submitted };
}

// The ticked foods to log; null while a row has no usable amount.
export function foodItems(rows: FoodRow[]): FoodItemInput[] | null {
  return rowItems(rows, (row, amount) => foodItem(row.source, row.food, amount));
}

// The meal's items to send; null while a row has no usable amount.
export function draftItems(rows: DraftRow[]): MealItemInput[] | null {
  return rowItems(rows, ({ source, food }, amount) => (source.kind === "saved" ? { id: source.id, amount } : foodItem(source, food, amount)));
}
