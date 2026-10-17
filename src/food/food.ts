import { randomUUID } from "node:crypto";
import { and, between, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppDatabase, Transaction } from "../db/database.js";
import { softDelete } from "../journal/records.js";
import { requestHash, withReceipt } from "../journal/receipt.js";
import { foodEntries } from "../db/schema.js";
import { instantAt, localDate, localTime } from "../time.js";
import { catalogFood } from "./catalog.js";
import { nutrientsOf, storedNutrients } from "./stored-nutrients.js";
import { entrySchema, foodBatchSchema, manualFood, recordedFood, scaledFood, totalNutrients } from "./contract.js";
import type { CatalogFoodInput, FoodBatch, FoodBatchInput, FoodEntry, FoodInput, FoodSubmission, RecentFoods, RecordedFood, RepeatInput, SubmittedFood } from "./contract.js";

export type FoodCommand =
  | { kind: "create"; input: FoodSubmission }
  | { kind: "edit"; id: string; revision: number; input: FoodSubmission }
  | { kind: "repeat"; sourceId: string; input: RepeatInput }
  | { kind: "delete"; id: string; revision: number };

export type FoodMutationResult =
  | { outcome: "created" | "updated"; entry: FoodEntry }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" }
  | { outcome: "catalog-missing" | "invalid-amount" };

type FoodRow = typeof foodEntries.$inferSelect;

function entry(row: FoodRow) {
  return {
    id: row.id,
    revision: row.revision,
    occurredAt: row.occurredAt.toISOString(),
    timeZone: row.timeZone,
    localDate: row.localDate,
    food: {
      name: row.name,
      quantity: row.quantity,
      nutrients: nutrientsOf(row),
      catalogRef: row.catalogRef,
    },
    mealLogId: row.mealLogId,
  };
}

function values(input: FoodInput) {
  return {
    occurredAt: new Date(input.occurredAt),
    timeZone: input.timeZone,
    localDate: localDate(input.occurredAt, input.timeZone),
    name: input.food.name,
    quantity: input.food.quantity,
    ...storedNutrients(input.food.nutrients),
    catalogRef: input.food.catalogRef ?? null,
  };
}

function isCatalogInput(input: FoodSubmission): input is CatalogFoodInput {
  return "kind" in input.food;
}

function hash(command: FoodCommand): string {
  let request: FoodCommand | { kind: "catalog-create"; input: CatalogFoodInput } | { kind: "catalog-edit"; id: string; revision: number; input: CatalogFoodInput } = command;

  // Keep the fingerprint format used by receipts written before catalog resolution moved here.
  if ((command.kind === "create" || command.kind === "edit") && isCatalogInput(command.input)) {
    request = command.kind === "create"
      ? { kind: "catalog-create", input: command.input }
      : { kind: "catalog-edit", id: command.id, revision: command.revision, input: command.input };
  }

  return requestHash(request);
}

// A submitted food as the journal records it: a Ciqual food measured here, a typed one as sent. Null when the
// catalog lacks the Ciqual food. Logging and saving a meal both resolve foods this way.
export function resolveFood(food: SubmittedFood): RecordedFood | null {
  return "kind" in food ? catalogFood(food.ref, food.quantity.amount) : recordedFood(food);
}

function resolveInput(input: FoodSubmission): FoodInput | null {
  const food = resolveFood(input.food);

  return food && { occurredAt: input.occurredAt, timeZone: input.timeZone, food: manualFood(food) };
}

async function missingOrStale(tx: Transaction, userId: string, id: string): Promise<{ outcome: "missing" | "stale" }> {
  const [row] = await tx.select({ id: foodEntries.id }).from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id), isNull(foodEntries.deletedAt)));

  return { outcome: row ? "stale" : "missing" };
}

// Logs recorded foods at one time, in the order given. Copies the saved name, amount, nutrients and
// catalog reference, never the catalog's current values, so it keeps working after the catalog changes. A saved
// meal passes its log, so the foods can later be removed together.
export async function insertFoods(tx: Transaction, userId: string, when: Pick<RepeatInput, "occurredAt" | "timeZone">, foods: RecordedFood[], mealLogId: string | null = null): Promise<FoodEntry[]> {
  const rows = foods.map((food) => ({ id: randomUUID(), userId, mealLogId, ...values({ ...when, food: manualFood(food) }) }));
  const inserted = await tx.insert(foodEntries).values(rows).returning();
  const byId = new Map(inserted.map((row) => [row.id, entry(row)]));

  return rows.map(({ id }) => {
    const created = byId.get(id);

    if (!created) throw new Error("Food insert returned no row");

    return created;
  });
}

// Removes every food a meal log added that is still logged, edited or not.
export async function deleteMealFoods(tx: Transaction, userId: string, mealLogId: string): Promise<void> {
  await tx.update(foodEntries)
    .set({ revision: sql`${foodEntries.revision} + 1`, deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.mealLogId, mealLogId), isNull(foodEntries.deletedAt)));
}

// The person's current foods among these entries, by entry id. Deleted and unknown ids are absent.
async function recordedFoods(tx: Transaction, userId: string, ids: string[]): Promise<Map<string, RecordedFood>> {
  const rows = await tx.select().from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), inArray(foodEntries.id, ids), isNull(foodEntries.deletedAt)));

  return new Map(rows.map((row) => [row.id, entry(row).food]));
}

// A food to log: a logged entry copied, scaled when an amount is given, or a food as logging submits it.
export type FoodItem = { entryId: string; amount?: number | undefined } | { food: SubmittedFood };

export type FoodSource = { outcome: "found"; food: RecordedFood } | { outcome: "missing" | "catalog-missing" };

// The food each item copies, before any amount is applied: a logged entry's as recorded (a deleted or unknown entry
// is missing), or a submitted food as the journal records it. The entries are read in one query up front.
export async function foodSources(tx: Transaction, userId: string, items: FoodItem[]): Promise<(item: FoodItem) => FoodSource> {
  const entryIds = items.flatMap((item) => ("entryId" in item ? [item.entryId] : []));
  const entries = entryIds.length > 0 ? await recordedFoods(tx, userId, entryIds) : new Map<string, RecordedFood>();

  return (item) => {
    const food = "entryId" in item ? entries.get(item.entryId) : resolveFood(item.food);

    if (food) return { outcome: "found", food };

    return { outcome: "entryId" in item ? "missing" : "catalog-missing" };
  };
}

export type LogFoodsResult = { outcome: "created"; entries: FoodEntry[] } | { outcome: "missing" | "catalog-missing" | "invalid-amount" };

// Logs the items at one time, all or none, in the order given. A scaled entry must still fit the journal's limits,
// which a tiny recorded amount scaled up can exceed.
export async function logFoods(tx: Transaction, userId: string, when: Pick<RepeatInput, "occurredAt" | "timeZone">, items: FoodItem[]): Promise<LogFoodsResult> {
  const source = await foodSources(tx, userId, items);
  const foods: RecordedFood[] = [];

  for (const item of items) {
    const found = source(item);

    if (found.outcome !== "found") return found;
    const food = "amount" in item && item.amount !== undefined ? scaledFood(found.food, item.amount) : found.food;

    if (!food) return { outcome: "invalid-amount" };
    foods.push(food);
  }

  return { outcome: "created", entries: await insertFoods(tx, userId, when, foods) };
}

async function repeat(tx: Transaction, userId: string, entryId: string, { amount, ...when }: RepeatInput): Promise<FoodMutationResult> {
  const result = await logFoods(tx, userId, when, [{ entryId, amount }]);

  if (result.outcome !== "created") return result;
  const [created] = result.entries;

  if (!created) throw new Error("Food insert returned no row");

  return { outcome: "created", entry: created };
}

async function insert(tx: Transaction, userId: string, input: FoodInput): Promise<{ outcome: "created"; entry: FoodEntry }> {
  const [row] = await tx.insert(foodEntries).values({ id: randomUUID(), userId, ...values(input) }).returning();

  if (!row) throw new Error("Food insert returned no row");

  return { outcome: "created", entry: entry(row) };
}

async function update(tx: Transaction, userId: string, id: string, revision: number, input: FoodInput): Promise<{ outcome: "updated"; entry: FoodEntry } | { outcome: "missing" | "stale" }> {
  const [row] = await tx.update(foodEntries)
    .set({ ...values(input), revision: sql`${foodEntries.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id), eq(foodEntries.revision, revision), isNull(foodEntries.deletedAt)))
    .returning();

  return row ? { outcome: "updated", entry: entry(row) } : missingOrStale(tx, userId, id);
}

// A change to a logged food. A date or time left out keeps the entry's own, read on its wall clock, and the zone
// never changes. A new amount scales the recorded nutrients unless nutrients are given for it.
export type FoodEdit = { date?: string | undefined; time?: string | undefined; name?: string | undefined; amount?: number | undefined; nutrients?: RecordedFood["nutrients"] | undefined };

// Edits an entry in place against the revision it is read at, so the change applies to what is stored now.
export async function editFood(db: AppDatabase, userId: string, id: string, edit: FoodEdit): Promise<{ outcome: "updated"; entry: FoodEntry } | { outcome: "missing" | "stale" | "invalid-amount" }> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id), isNull(foodEntries.deletedAt))).for("update");

    if (!row) return { outcome: "missing" };
    const current = entry(row);
    const scaled = edit.amount === undefined ? current.food : scaledFood(current.food, edit.amount);

    if (!scaled) return { outcome: "invalid-amount" };
    const food = { ...scaled };

    if (edit.name !== undefined) food.name = edit.name;

    // Own nutrients are no longer the catalog's, so the food stops claiming its source.
    if (edit.nutrients !== undefined) {
      food.nutrients = edit.nutrients;
      food.catalogRef = null;
    }

    const moved = edit.date !== undefined || edit.time !== undefined;
    const occurredAt = moved ? instantAt(edit.date ?? current.localDate, edit.time ?? localTime(current.occurredAt, current.timeZone), current.timeZone) : current.occurredAt;

    return update(tx, userId, id, row.revision, { occurredAt, timeZone: current.timeZone, food: manualFood(food) });
  });
}

export async function mutateFood(db: AppDatabase, userId: string, key: string, command: FoodCommand): Promise<FoodMutationResult> {
  return withReceipt(db, userId, key, hash(command), (receipt): FoodMutationResult => {
    const { outcome, body } = receipt;

    if (outcome === null) throw new Error("Incomplete receipt cannot be replayed");

    if (outcome === "created" || outcome === "updated") return { outcome, entry: entrySchema.parse(body) };

    return { outcome };
  }, async (tx): Promise<FoodMutationResult> => {
    if (command.kind === "delete") return softDelete(tx, foodEntries, userId, command.id, command.revision);

    if (command.kind === "repeat") return repeat(tx, userId, command.sourceId, command.input);
    const input = resolveInput(command.input);

    if (!input) return { outcome: "catalog-missing" };

    return command.kind === "create" ? insert(tx, userId, input) : update(tx, userId, command.id, command.revision, input);
  });
}

export type FoodBatchResult =
  | { outcome: "created"; entry: FoodBatch }
  | { outcome: "missing" | "key-reuse" | "catalog-missing" | "invalid-amount" };

// Logs several foods at one time under one idempotency key.
export async function logFoodBatch(db: AppDatabase, userId: string, key: string, input: FoodBatchInput): Promise<FoodBatchResult> {
  const { items, ...when } = input;

  return withReceipt(db, userId, key, requestHash({ kind: "food-batch", input }), (receipt): FoodBatchResult => {
    const { outcome, body } = receipt;

    if (outcome === "created") return { outcome, entry: foodBatchSchema.parse(body) };

    if (outcome === "missing" || outcome === "key-reuse") return { outcome };

    throw new Error("Food batch receipt cannot be replayed");
  }, async (tx): Promise<FoodBatchResult> => {
    const result = await logFoods(tx, userId, when, items);

    return result.outcome === "created" ? { outcome: "created", entry: { entries: result.entries } } : result;
  });
}

const recentScan = 500;

const recentLimit = 20;

// Entries name the same food when they share a name (ignoring case and spacing), a catalog food
// in any release, and a unit. Amounts and nutrients may differ.
function foodIdentity({ name, quantity, catalogRef }: RecordedFood): string {
  return JSON.stringify([name.trim().replace(/\s+/g, " ").toLowerCase(), catalogRef?.provider ?? null, catalogRef?.id ?? null, quantity.unit]);
}

// The first entry of each food, in the order given, up to the limit. Entries come newest first.
function distinctFoods(entries: FoodEntry[]): RecentFoods["foods"] {
  const seen = new Set<string>();
  const foods = [];

  for (const { id, localDate, food } of entries) {
    const identity = foodIdentity(food);

    if (seen.has(identity)) continue;
    seen.add(identity);
    foods.push({ entryId: id, lastEaten: localDate, food });

    if (foods.length === recentLimit) break;
  }

  return foods;
}

// Foods from the person's latest entries, most recently eaten first, and among foods eaten at the same
// time the latest logged first. Older foods are found by search.
export async function getRecentFoods(db: AppDatabase, userId: string): Promise<RecentFoods> {
  const rows = await db.select().from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), isNull(foodEntries.deletedAt)))
    .orderBy(desc(foodEntries.localDate), desc(foodEntries.occurredAt), desc(foodEntries.createdAt), desc(foodEntries.id))
    .limit(recentScan);

  return { foods: distinctFoods(rows.map(entry)) };
}

export async function getFoodDay(db: AppDatabase, userId: string, date: string) {
  const rows = await db.select().from(foodEntries).where(and(
    eq(foodEntries.userId, userId), eq(foodEntries.localDate, date), isNull(foodEntries.deletedAt),
  )).orderBy(foodEntries.occurredAt, foodEntries.id);

  return {
    date,
    food: {
      entries: rows.map(entry),
      entryCount: rows.length,
      totals: foodTotals(rows),
    },
  };
}

export type FoodRangeDay = { entryCount: number; kcal: number | null; proteinG: number | null };

type NutrientRow = Pick<FoodRow, "kcalMilli" | "proteinMilli" | "carbsMilli" | "fatMilli">;

// A total is known only when every logged food has that nutrient.
function foodTotals(rows: NutrientRow[]) {
  return totalNutrients(rows.map(nutrientsOf));
}

// Days from `from` to `to` that have foods, by local date. A total is null unless every food on the day has the value.
export async function getFoodRange(db: AppDatabase, userId: string, from: string, to: string): Promise<Map<string, FoodRangeDay>> {
  const rows = await db.select({
    localDate: foodEntries.localDate,
    kcalMilli: foodEntries.kcalMilli,
    proteinMilli: foodEntries.proteinMilli,
    carbsMilli: foodEntries.carbsMilli,
    fatMilli: foodEntries.fatMilli,
  }).from(foodEntries).where(and(
    eq(foodEntries.userId, userId), between(foodEntries.localDate, from, to), isNull(foodEntries.deletedAt),
  ));

  const days = new Map<string, NutrientRow[]>();

  for (const { localDate, ...nutrients } of rows) {
    const entries = days.get(localDate) ?? [];

    entries.push(nutrients);
    days.set(localDate, entries);
  }

  return new Map([...days].map(([date, entries]) => {
    const { kcal, proteinG } = foodTotals(entries);

    return [date, { entryCount: entries.length, kcal, proteinG }];
  }));
}
