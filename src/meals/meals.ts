import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import type { AppDatabase, Transaction } from "../db/database.js";
import { savedMeals } from "../db/schema.js";
import { insertFoods, recordedFoods, resolveFood } from "../food/food.js";
import { softDelete } from "../journal/records.js";
import { withReceipt } from "../journal/receipt.js";
import { scaledFood } from "../food/contract.js";
import type { RecordedFood } from "../food/contract.js";
import { instantAt, localDate, shiftDate } from "../time.js";
import { mealLogSchema, savedMealSchema } from "./contract.js";
import type { MealDaily, MealInput, MealItemInput, MealLog, MealLogInput, SavedMeal, SavedMealList, StoredMealItem } from "./contract.js";

export type MealCommand =
  | { kind: "create"; input: MealInput }
  | { kind: "edit"; id: string; revision: number; input: MealInput }
  | { kind: "delete"; id: string; revision: number };

// "missing" means the meal, or a logged entry an item copies, is gone; "catalog-missing" a Ciqual food the catalog
// lacks. "invalid-item" (a saved item the meal lacks, or an amount whose nutrients exceed the journal's limits) and
// "catalog-missing" keep no receipt, so the key can be sent again once fixed.
export type MealMutationResult =
  | { outcome: "created" | "updated"; entry: SavedMeal }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" | "invalid-item" | "catalog-missing" };

export type MealLogResult =
  | { outcome: "created"; entry: MealLog }
  | { outcome: "missing" | "key-reuse" | "invalid-item" };

type MealRow = typeof savedMeals.$inferSelect;

function meal(row: MealRow): SavedMeal {
  const daily = row.dailyTime && row.dailyTimeZone ? { time: row.dailyTime, timeZone: row.dailyTimeZone } : null;

  return { id: row.id, revision: row.revision, name: row.name, items: row.items.map(({ id, food }) => ({ id, food })), daily };
}

function today(zone: string): string {
  return localDate(new Date().toISOString(), zone);
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

// The daily columns a write sets, given the meal as stored (none for a new meal). Only turning a meal on moves the
// cursor: to yesterday, so today fills next, and never back, so turning it off and on again the same day fills
// nothing twice. A meal already on keeps its cursor, so an edit never skips days not yet filled, and turning it
// off keeps the days already filled.
function dailyColumns(daily: MealDaily | null, stored: Pick<MealRow, "dailyTime" | "dailyFilledThrough"> | null) {
  if (!daily) return { dailyTime: null, dailyTimeZone: null };
  const setting = { dailyTime: daily.time, dailyTimeZone: daily.timeZone };

  // A meal already on always has a cursor (saved_meals_daily_check).
  if (stored?.dailyTime) return setting;
  const cursor = stored?.dailyFilledThrough ?? null;
  const yesterday = shiftDate(today(daily.timeZone), -1);

  return { ...setting, dailyFilledThrough: cursor && cursor > yesterday ? cursor : yesterday };
}

// Why an item cannot be saved: its logged entry is gone, the catalog lacks it, or the meal lacks it or its amount
// is out of limits.
type ItemFailure = { outcome: "missing" | "catalog-missing" | "invalid-item" };

type Resolved = { outcome: "resolved"; items: StoredMealItem[] } | ItemFailure;

type Source = { outcome: "found"; item: StoredMealItem } | ItemFailure;

const newItem = (food: RecordedFood): Source => ({ outcome: "found", item: { id: randomUUID(), food } });

// The item an input names, before its amount is applied: a saved item keeps its id and basis; anything else is a
// new item whose basis is the food as resolved now, so later edits scale from it.
function source(input: MealItemInput, saved: Map<string, StoredMealItem>, entries: Map<string, RecordedFood>): Source {
  if ("id" in input) {
    const item = saved.get(input.id);

    return item ? { outcome: "found", item } : { outcome: "invalid-item" };
  }

  if ("entryId" in input) {
    const food = entries.get(input.entryId);

    return food ? newItem(food) : { outcome: "missing" };
  }

  const food = resolveFood(input.food);

  return food ? newItem(food) : { outcome: "catalog-missing" };
}

// Each input as a stored item at its amount, in the order given. A submitted food is kept at the amount it was sent.
async function resolveItems(tx: Transaction, userId: string, saved: StoredMealItem[], inputs: MealItemInput[]): Promise<Resolved> {
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const entryIds = inputs.flatMap((input) => ("entryId" in input ? [input.entryId] : []));
  const entries = entryIds.length > 0 ? await recordedFoods(tx, userId, entryIds) : new Map<string, RecordedFood>();
  const items = [];

  for (const input of inputs) {
    const from = source(input, savedById, entries);

    if (from.outcome !== "found") return from;
    const item = portion(from.item, "amount" in input ? input.amount : input.food.quantity.amount);

    if (!item) return { outcome: "invalid-item" };
    items.push(item);
  }

  return { outcome: "resolved", items };
}

async function createMeal(tx: Transaction, userId: string, input: MealInput): Promise<MealMutationResult> {
  const resolved = await resolveItems(tx, userId, [], input.items);

  if (resolved.outcome !== "resolved") return resolved;

  const [row] = await tx.insert(savedMeals).values({ id: randomUUID(), userId, name: input.name, items: resolved.items, ...dailyColumns(input.daily, null) }).returning();

  if (!row) throw new Error("Saved meal insert returned no row");

  return { outcome: "created", entry: meal(row) };
}

async function editMeal(tx: Transaction, userId: string, id: string, revision: number, input: MealInput): Promise<MealMutationResult> {
  const [row] = await tx.select().from(savedMeals)
    .where(and(eq(savedMeals.userId, userId), eq(savedMeals.id, id), isNull(savedMeals.deletedAt))).for("update");

  if (!row) return { outcome: "missing" };

  if (row.revision !== revision) return { outcome: "stale" };
  const resolved = await resolveItems(tx, userId, row.items, input.items);

  if (resolved.outcome !== "resolved") return resolved;

  const [updated] = await tx.update(savedMeals)
    .set({ name: input.name, items: resolved.items, ...dailyColumns(input.daily, row), revision: sql`${savedMeals.revision} + 1`, updatedAt: new Date() })
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

// Saving copies each food, so later edits to a logged day or the catalog never change the meal.
export async function mutateMeal(db: AppDatabase, userId: string, key: string, command: MealCommand): Promise<MealMutationResult> {
  return withReceipt(db, userId, key, hash(command), (receipt): MealMutationResult => {
    const { outcome, body } = receipt;

    if (outcome === null) throw new Error("Saved meal receipt cannot be replayed");

    if (outcome === "created" || outcome === "updated") return { outcome, entry: savedMealSchema.parse(body) };

    return { outcome };
  }, async (tx): Promise<MealMutationResult> => {
    if (command.kind === "delete") return softDelete(tx, savedMeals, userId, command.id, command.revision);

    if (command.kind === "edit") return editMeal(tx, userId, command.id, command.revision, command.input);

    return createMeal(tx, userId, command.input);
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

// What a daily meal still has to log: each local day after its cursor through today in its zone, at its time.
// Null when it is off or already up to date. The three columns are set together (saved_meals_daily_check).
function dueFill(row: Pick<MealRow, "dailyTime" | "dailyTimeZone" | "dailyFilledThrough">) {
  const { dailyTime: time, dailyTimeZone: timeZone, dailyFilledThrough: cursor } = row;

  if (!time || !timeZone || !cursor) return null;
  const through = today(timeZone);
  const days = [];

  for (let date = shiftDate(cursor, 1); date <= through; date = shiftDate(date, 1)) days.push(date);

  return days.length > 0 ? { time, timeZone, days, through } : null;
}

// Logs each daily meal on every local day it is due, at its time, and moves the cursor. The reads that show logged
// foods and the MCP get_day tool call this first, so a day never opened still counts. "Due" is decided here, not
// in SQL, because zones are checked with Intl and Postgres's zone list can differ. The due rows are locked and read again, so two
// reads at once fill each day once.
export async function fillDailyMeals(db: AppDatabase, userId: string): Promise<void> {
  const active = and(eq(savedMeals.userId, userId), isNotNull(savedMeals.dailyTime), isNull(savedMeals.deletedAt));
  const candidates = await db.select({ id: savedMeals.id, dailyTime: savedMeals.dailyTime, dailyTimeZone: savedMeals.dailyTimeZone, dailyFilledThrough: savedMeals.dailyFilledThrough }).from(savedMeals).where(active);
  const due = candidates.filter((row) => dueFill(row) !== null).map(({ id }) => id);

  if (due.length === 0) return;

  await db.transaction(async (tx) => {
    const rows = await tx.select().from(savedMeals).where(and(active, inArray(savedMeals.id, due))).for("update");

    for (const row of rows) {
      const fill = dueFill(row);

      if (!fill) continue;
      const foods = row.items.map((item) => item.food);

      for (const date of fill.days) {
        await insertFoods(tx, userId, { occurredAt: instantAt(date, fill.time, fill.timeZone), timeZone: fill.timeZone }, foods);
      }

      await tx.update(savedMeals).set({ dailyFilledThrough: fill.through }).where(eq(savedMeals.id, row.id));
    }
  });
}
