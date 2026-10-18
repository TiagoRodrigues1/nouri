import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, max, sql } from "drizzle-orm";
import type { AppDatabase, Transaction } from "../db/database.js";
import { foodEntries, mealLogs, savedMeals } from "../db/schema.js";
import { deleteMealFoods, foodSources, insertFoods } from "../food/food.js";
import { softDelete } from "../journal/records.js";
import { requestHash, withReceipt } from "../journal/receipt.js";
import { scaledFood } from "../food/contract.js";
import type { FoodItemInput } from "../food/contract.js";
import { instantAt, isoWeekday, localDate, shiftDate } from "../time.js";
import { everyDay, mealLogSchema, savedMealSchema } from "./contract.js";
import type { MealDaily, MealInput, MealItemInput, MealLog, MealLogInput, MealLogRef, SavedMeal, SavedMealList, StoredMealItem } from "./contract.js";

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

export type MealLogUndoResult = { outcome: "deleted" | "missing" | "key-reuse" };

type MealRow = typeof savedMeals.$inferSelect;

function meal(row: MealRow): SavedMeal {
  const { dailyTime: time, dailyTimeZone: timeZone, dailyWeekdays: weekdays } = row;
  const daily = time && timeZone && weekdays ? { time, timeZone, weekdays } : null;

  return { id: row.id, revision: row.revision, name: row.name, items: row.items.map(({ id, food }) => ({ id, food })), daily };
}

function today(zone: string): string {
  return localDate(new Date().toISOString(), zone);
}

// Receipts share one key space, so the fingerprint names saved meals.
function hash<Request extends { kind: MealCommand["kind"] | "log" | "undo" }>(request: Request): string {
  return requestHash({ ...request, kind: `saved-meal-${request.kind}` });
}

// A daily meal saved for every day is fingerprinted without its weekdays, as it was before they existed, so a
// write retried across that change still replays.
function fingerprintInput(input: MealInput) {
  if (!input.daily || input.daily.weekdays.length < everyDay.length) return input;
  const { time, timeZone } = input.daily;

  return { ...input, daily: { time, timeZone } };
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
// off keeps the days already filled. New weekdays apply from the next unfilled day.
function dailyColumns(daily: MealDaily | null, stored: Pick<MealRow, "dailyTime" | "dailyFilledThrough"> | null) {
  if (!daily) return { dailyTime: null, dailyTimeZone: null, dailyWeekdays: null };
  const setting = { dailyTime: daily.time, dailyTimeZone: daily.timeZone, dailyWeekdays: daily.weekdays.toSorted((a, b) => a - b) };

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

// Each input as a stored item at its amount, in the order given. A saved item keeps its id and basis; any other is a
// new item whose basis is the food as resolved now, so later edits scale from it. A submitted food is kept at the
// amount it was sent.
async function resolveItems(tx: Transaction, userId: string, saved: StoredMealItem[], inputs: MealItemInput[]): Promise<Resolved> {
  const savedById = new Map(saved.map((item) => [item.id, item]));
  const source = await foodSources(tx, userId, inputs.filter((input): input is FoodItemInput => !("id" in input)));
  const items = [];

  for (const input of inputs) {
    let from: StoredMealItem;

    if ("id" in input) {
      const item = savedById.get(input.id);

      if (!item) return { outcome: "invalid-item" };
      from = item;
    } else {
      const found = source(input);

      if (found.outcome !== "found") return found;
      from = { id: randomUUID(), food: found.food };
    }

    const item = portion(from, "amount" in input ? input.amount : input.food.quantity.amount);

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

// Meals most recently used first: logged by hand and not removed since, or else saved. Daily fills are logged for
// the person, so they never move a meal up, but they do count as the last day the meal is on.
export async function listMeals(db: AppDatabase, userId: string): Promise<SavedMealList> {
  const lastUsed = db.select({ mealId: mealLogs.savedMealId, at: max(mealLogs.createdAt).as("at") }).from(mealLogs)
    .where(and(eq(mealLogs.userId, userId), isNull(mealLogs.deletedAt), eq(mealLogs.daily, false)))
    .groupBy(mealLogs.savedMealId).as("last_used");

  // A log whose foods were all removed one by one is on no day.
  const lastDay = db.select({ mealId: mealLogs.savedMealId, day: max(foodEntries.localDate).as("day") }).from(mealLogs)
    .innerJoin(foodEntries, and(eq(foodEntries.mealLogId, mealLogs.id), isNull(foodEntries.deletedAt)))
    .where(and(eq(mealLogs.userId, userId), isNull(mealLogs.deletedAt)))
    .groupBy(mealLogs.savedMealId).as("last_day");

  const rows = await db.select({ meal: savedMeals, lastLogged: lastDay.day }).from(savedMeals)
    .leftJoin(lastUsed, eq(lastUsed.mealId, savedMeals.id))
    .leftJoin(lastDay, eq(lastDay.mealId, savedMeals.id))
    .where(and(eq(savedMeals.userId, userId), isNull(savedMeals.deletedAt)))
    // greatest skips the null of a meal never logged.
    .orderBy(desc(sql`greatest(${lastUsed.at}, ${savedMeals.createdAt})`), savedMeals.id);

  return { meals: rows.map((row) => ({ ...meal(row.meal), lastLogged: row.lastLogged })) };
}

// Saving copies each food, so later edits to a logged day or the catalog never change the meal.
export async function mutateMeal(db: AppDatabase, userId: string, key: string, command: MealCommand): Promise<MealMutationResult> {
  const fingerprint = command.kind === "delete" ? command : { ...command, input: fingerprintInput(command.input) };

  return withReceipt(db, userId, key, hash(fingerprint), (receipt): MealMutationResult => {
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

    const log = await startLog(tx, userId, row, false);
    const entries = await insertFoods(tx, userId, { occurredAt: input.occurredAt, timeZone: input.timeZone }, foods, log);

    return { outcome: "created", entry: { entries } };
  });
}

// Records one logging of the meal under its current name, for its foods to point at.
async function startLog(tx: Transaction, userId: string, row: MealRow, daily: boolean): Promise<string> {
  const id = randomUUID();

  await tx.insert(mealLogs).values({ id, userId, savedMealId: row.id, name: row.name, daily });

  return id;
}

// Removes a logging of a meal and every food it added that is still logged, whether or not it was edited since. A
// log never changes once written, so there is no revision to check.
export async function undoMealLog(db: AppDatabase, userId: string, key: string, id: string): Promise<MealLogUndoResult> {
  return withReceipt(db, userId, key, hash({ kind: "undo", id }), (receipt): MealLogUndoResult => {
    const { outcome } = receipt;

    if (outcome === "deleted" || outcome === "missing" || outcome === "key-reuse") return { outcome };

    throw new Error("Meal log undo receipt cannot be replayed");
  }, async (tx): Promise<MealLogUndoResult> => {
    const [log] = await tx.update(mealLogs).set({ deletedAt: new Date() })
      .where(and(eq(mealLogs.userId, userId), eq(mealLogs.id, id), isNull(mealLogs.deletedAt)))
      .returning({ id: mealLogs.id });

    if (!log) return { outcome: "missing" };
    await deleteMealFoods(tx, userId, log.id);

    return { outcome: "deleted" };
  });
}

// The logs these entries came from that are still standing, named as each meal was when logged.
export async function mealLogsFor(db: AppDatabase, userId: string, ids: string[]): Promise<MealLogRef[]> {
  if (ids.length === 0) return [];

  return db.select({ id: mealLogs.id, name: mealLogs.name }).from(mealLogs)
    .where(and(eq(mealLogs.userId, userId), inArray(mealLogs.id, [...new Set(ids)]), isNull(mealLogs.deletedAt)))
    .orderBy(mealLogs.createdAt, mealLogs.id);
}

// What a daily meal still has to log: each local day after its cursor through today in its zone that falls on one
// of its weekdays, at its time. The cursor still moves past the other days, so changing the weekdays later never
// fills a day already passed. Null when it is off or already up to date. The columns are set together
// (saved_meals_daily_check, saved_meals_daily_weekdays_check).
function dueFill(row: Pick<MealRow, "dailyTime" | "dailyTimeZone" | "dailyFilledThrough" | "dailyWeekdays">) {
  const { dailyTime: time, dailyTimeZone: timeZone, dailyFilledThrough: cursor, dailyWeekdays: weekdays } = row;

  if (!time || !timeZone || !cursor || !weekdays) return null;
  const through = today(timeZone);

  if (cursor >= through) return null;
  const days = [];

  for (let date = shiftDate(cursor, 1); date <= through; date = shiftDate(date, 1)) {
    if (weekdays.includes(isoWeekday(date))) days.push(date);
  }

  return { time, timeZone, days, through };
}

// Logs each daily meal on every local day it is due, at its time, and moves the cursor. The reads that show logged
// foods and the MCP get_day tool call this first, so a day never opened still counts. "Due" is decided here, not
// in SQL, because zones are checked with Intl and Postgres's zone list can differ. The due rows are locked and read again, so two
// reads at once fill each day once.
export async function fillDailyMeals(db: AppDatabase, userId: string): Promise<void> {
  const active = and(eq(savedMeals.userId, userId), isNotNull(savedMeals.dailyTime), isNull(savedMeals.deletedAt));
  const candidates = await db.select({ id: savedMeals.id, dailyTime: savedMeals.dailyTime, dailyTimeZone: savedMeals.dailyTimeZone, dailyFilledThrough: savedMeals.dailyFilledThrough, dailyWeekdays: savedMeals.dailyWeekdays }).from(savedMeals).where(active);
  const due = candidates.filter((row) => dueFill(row) !== null).map(({ id }) => id);

  if (due.length === 0) return;

  await db.transaction(async (tx) => {
    const rows = await tx.select().from(savedMeals).where(and(active, inArray(savedMeals.id, due))).for("update");

    for (const row of rows) {
      const fill = dueFill(row);

      if (!fill) continue;
      const foods = row.items.map((item) => item.food);

      // Each day is a log of its own, so a day the meal was skipped can be removed whole.
      for (const date of fill.days) {
        await insertFoods(tx, userId, { occurredAt: instantAt(date, fill.time, fill.timeZone), timeZone: fill.timeZone }, foods, await startLog(tx, userId, row, true));
      }

      await tx.update(savedMeals).set({ dailyFilledThrough: fill.through }).where(eq(savedMeals.id, row.id));
    }
  });
}
