import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AppDatabase, Transaction } from "../db/database.js";
import { savedMeals } from "../db/schema.js";
import { insertFoods, recordedFoods } from "../food/food.js";
import { softDelete } from "../journal/records.js";
import { withReceipt } from "../journal/receipt.js";
import { scaledFood } from "../food/contract.js";
import { mealLogSchema, savedMealSchema } from "./contract.js";
import type { MealEdit, MealInput, MealLog, MealLogInput, SavedMeal, SavedMealList, StoredMealItem } from "./contract.js";

export type MealCommand =
  | { kind: "create"; input: MealInput }
  | { kind: "edit"; id: string; revision: number; input: MealEdit }
  | { kind: "delete"; id: string; revision: number };

// "missing" on create means a chosen entry is gone. "invalid-item" (an item the meal lacks, or an amount
// whose nutrients exceed the journal's limits) keeps no receipt, so the key can be sent again once fixed.
export type MealMutationResult =
  | { outcome: "created" | "updated"; entry: SavedMeal }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" | "invalid-item" };

export type MealLogResult =
  | { outcome: "created"; entry: MealLog }
  | { outcome: "missing" | "key-reuse" | "invalid-item" };

type MealRow = typeof savedMeals.$inferSelect;

function meal(row: MealRow): SavedMeal {
  return { id: row.id, revision: row.revision, name: row.name, items: row.items.map(({ id, food }) => ({ id, food })) };
}

// Receipts share one key space, so the fingerprint names saved meals.
function hash(request: MealCommand | { kind: "log"; id: string; input: MealLogInput }): string {
  return createHash("sha256").update(JSON.stringify({ ...request, kind: `saved-meal-${request.kind}` })).digest("hex");
}

// The item at another amount, scaled from its basis so a chain of edits matches a single one.
function portion(item: StoredMealItem, amount: number): StoredMealItem | null {
  const basis = item.basis ?? item.food;
  const food = scaledFood(basis, amount);

  return food ? { id: item.id, food, basis } : null;
}

// The kept items in the meal's order at their new amounts; null when one is unknown or out of limits.
function editedItems(items: StoredMealItem[], chosen: MealEdit["items"]): StoredMealItem[] | null {
  const amounts = new Map(chosen.map((item) => [item.id, item.amount]));
  const kept = items.filter((item) => amounts.has(item.id));

  if (kept.length !== amounts.size) return null;
  const edited = [];

  for (const item of kept) {
    const next = portion(item, amounts.get(item.id) ?? item.food.quantity.amount);

    if (!next) return null;
    edited.push(next);
  }

  return edited;
}

async function editMeal(tx: Transaction, userId: string, id: string, revision: number, input: MealEdit): Promise<MealMutationResult> {
  const [row] = await tx.select().from(savedMeals)
    .where(and(eq(savedMeals.userId, userId), eq(savedMeals.id, id), isNull(savedMeals.deletedAt))).for("update");

  if (!row) return { outcome: "missing" };

  if (row.revision !== revision) return { outcome: "stale" };
  const items = editedItems(row.items, input.items);

  if (!items) return { outcome: "invalid-item" };

  const [updated] = await tx.update(savedMeals)
    .set({ name: input.name, items, revision: sql`${savedMeals.revision} + 1`, updatedAt: new Date() })
    .where(eq(savedMeals.id, row.id)).returning();

  if (!updated) throw new Error("Saved meal update returned no row");

  return { outcome: "updated", entry: meal(updated) };
}

export async function listMeals(db: AppDatabase, userId: string): Promise<SavedMealList> {
  const rows = await db.select().from(savedMeals)
    .where(and(eq(savedMeals.userId, userId), isNull(savedMeals.deletedAt)))
    .orderBy(desc(savedMeals.createdAt), savedMeals.id);

  return { meals: rows.map(meal) };
}

// Saving copies each chosen entry's food at the amount given, so later edits to that day never change the meal.
// Editing renames the meal, re-amounts or removes items, and keeps each item's id and food.
export async function mutateMeal(db: AppDatabase, userId: string, key: string, command: MealCommand): Promise<MealMutationResult> {
  return withReceipt(db, userId, key, hash(command), (receipt): MealMutationResult => {
    const { outcome, body } = receipt;

    if (outcome === null) throw new Error("Saved meal receipt cannot be replayed");

    if (outcome === "created" || outcome === "updated") return { outcome, entry: savedMealSchema.parse(body) };

    return { outcome };
  }, async (tx): Promise<MealMutationResult> => {
    if (command.kind === "delete") return softDelete(tx, savedMeals, userId, command.id, command.revision);

    if (command.kind === "edit") return editMeal(tx, userId, command.id, command.revision, command.input);

    const { name, items: chosen } = command.input;
    const foods = await recordedFoods(tx, userId, chosen.map((item) => item.entryId));
    const items = [];

    for (const { entryId, amount } of chosen) {
      const food = foods.get(entryId);

      if (!food) return { outcome: "missing" };
      const item = portion({ id: randomUUID(), food }, amount);

      if (!item) return { outcome: "invalid-item" };
      items.push(item);
    }

    const [row] = await tx.insert(savedMeals).values({ id: randomUUID(), userId, name, items }).returning();

    if (!row) throw new Error("Saved meal insert returned no row");

    return { outcome: "created", entry: meal(row) };
  });
}

// Logs the chosen items of a meal at one time, all or none, in the meal's order. An edit keeps each item's
// food and only its amount changes, so the items the page showed are the items logged; a meal deleted
// meanwhile is missing, and an item removed meanwhile is one the meal lacks.
export async function logMeal(db: AppDatabase, userId: string, key: string, id: string, input: MealLogInput): Promise<MealLogResult> {
  return withReceipt(db, userId, key, hash({ kind: "log", id, input }), (receipt): MealLogResult => {
    const { outcome, body } = receipt;

    if (outcome === "created") return { outcome, entry: mealLogSchema.parse(body) };

    if (outcome === "missing" || outcome === "key-reuse") return { outcome };

    throw new Error("Saved meal log receipt cannot be replayed");
  }, async (tx): Promise<MealLogResult> => {
    const [row] = await tx.select().from(savedMeals)
      .where(and(eq(savedMeals.userId, userId), eq(savedMeals.id, id), isNull(savedMeals.deletedAt)));

    if (!row) return { outcome: "missing" };
    const amounts = new Map(input.items.map((item) => [item.id, item.amount]));
    const chosen = row.items.filter((item) => amounts.has(item.id));

    if (chosen.length !== amounts.size) return { outcome: "invalid-item" };
    const foods = [];

    for (const item of chosen) {
      const logged = portion(item, amounts.get(item.id) ?? item.food.quantity.amount);

      if (!logged) return { outcome: "invalid-item" };
      foods.push(logged.food);
    }

    const entries = await insertFoods(tx, userId, { occurredAt: input.occurredAt, timeZone: input.timeZone }, foods);

    return { outcome: "created", entry: { entries } };
  });
}
