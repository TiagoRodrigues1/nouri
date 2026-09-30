import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/database.js";
import { savedMeals } from "../db/schema.js";
import { insertFoods, recordedFoods } from "../food/food.js";
import { softDelete } from "../journal/records.js";
import { withReceipt } from "../journal/receipt.js";
import { mealFoodSchema, mealLogSchema, savedMealSchema, scaleFood } from "./contract.js";
import type { MealFood, MealInput, MealLog, MealLogInput, SavedMeal, SavedMealList } from "./contract.js";

export type MealCommand =
  | { kind: "create"; input: MealInput }
  | { kind: "delete"; id: string; revision: number };

// "missing" on create means a chosen entry is gone. "invalid-item" (an item the meal lacks, or an amount
// whose nutrients exceed the journal's limits) keeps no receipt, so the key can be sent again once fixed.
export type MealMutationResult =
  | { outcome: "created"; entry: SavedMeal }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" | "invalid-item" };

export type MealLogResult =
  | { outcome: "created"; entry: MealLog }
  | { outcome: "missing" | "key-reuse" | "invalid-item" };

type MealRow = typeof savedMeals.$inferSelect;

function meal(row: MealRow): SavedMeal {
  return { id: row.id, revision: row.revision, name: row.name, items: row.items };
}

// Receipts share one key space, so the fingerprint names saved meals.
function hash(request: MealCommand | { kind: "log"; id: string; input: MealLogInput }): string {
  return createHash("sha256").update(JSON.stringify({ ...request, kind: `saved-meal-${request.kind}` })).digest("hex");
}

// A scaled food must still fit the journal's limits, which a tiny saved amount scaled up can exceed.
function scaled(food: MealFood, amount: number): MealFood | null {
  const result = mealFoodSchema.safeParse(scaleFood(food, amount));

  return result.success ? result.data : null;
}

export async function listMeals(db: AppDatabase, userId: string): Promise<SavedMealList> {
  const rows = await db.select().from(savedMeals)
    .where(and(eq(savedMeals.userId, userId), isNull(savedMeals.deletedAt)))
    .orderBy(desc(savedMeals.createdAt), savedMeals.id);

  return { meals: rows.map(meal) };
}

// Saving copies each chosen entry's food at the amount given, so later edits to that day never change the meal.
export async function mutateMeal(db: AppDatabase, userId: string, key: string, command: MealCommand): Promise<MealMutationResult> {
  return withReceipt(db, userId, key, hash(command), (receipt): MealMutationResult => {
    const { outcome, body } = receipt;

    if (outcome === null || outcome === "updated") throw new Error("Saved meal receipt cannot be replayed");

    if (outcome === "created") return { outcome, entry: savedMealSchema.parse(body) };

    return { outcome };
  }, async (tx): Promise<MealMutationResult> => {
    if (command.kind === "delete") return softDelete(tx, savedMeals, userId, command.id, command.revision);

    const { name, items: chosen } = command.input;
    const foods = await recordedFoods(tx, userId, chosen.map((item) => item.entryId));
    const items = [];

    for (const { entryId, amount } of chosen) {
      const food = foods.get(entryId);

      if (!food) return { outcome: "missing" };
      const scaledFood = scaled(food, amount);

      if (!scaledFood) return { outcome: "invalid-item" };
      items.push({ id: randomUUID(), food: scaledFood });
    }

    const [row] = await tx.insert(savedMeals).values({ id: randomUUID(), userId, name, items }).returning();

    if (!row) throw new Error("Saved meal insert returned no row");

    return { outcome: "created", entry: meal(row) };
  }, "invalid-item");
}

// Logs the chosen items of a meal at one time, all or none, in the meal's order. A saved meal is never
// edited, so the items the page showed are the items logged; a meal deleted meanwhile is missing.
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
      const food = scaled(item.food, amounts.get(item.id) ?? item.food.quantity.amount);

      if (!food) return { outcome: "invalid-item" };
      foods.push(food);
    }

    const entries = await insertFoods(tx, userId, { occurredAt: input.occurredAt, timeZone: input.timeZone }, foods);

    return { outcome: "created", entry: { entries } };
  }, "invalid-item");
}
