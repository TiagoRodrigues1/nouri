import { createHash, randomUUID } from "node:crypto";
import { and, between, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AppDatabase, Transaction } from "../db/database.js";
import { softDelete } from "../journal/records.js";
import { withReceipt } from "../journal/receipt.js";
import { foodEntries } from "../db/schema.js";
import { localDate } from "../time.js";
import { resolveFood } from "./catalog.js";
import { entrySchema, manualFood, scaledFood } from "./contract.js";
import type { CatalogFoodInput, CatalogSelection, FoodEntry, FoodInput, FoodSubmission, RecentFoods, RecordedFood, RepeatInput } from "./contract.js";

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

function milli(value: number | null): number | null {
  return value === null ? null : Math.round(value * 1000);
}

function decimal(value: number | null): number | null {
  return value === null ? null : value / 1000;
}

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
      nutrients: {
        kcal: decimal(row.kcalMilli),
        proteinG: decimal(row.proteinMilli),
        carbsG: decimal(row.carbsMilli),
        fatG: decimal(row.fatMilli),
      },
      catalogRef: row.catalogRef,
    },
  };
}

function values(input: FoodInput) {
  return {
    occurredAt: new Date(input.occurredAt),
    timeZone: input.timeZone,
    localDate: localDate(input.occurredAt, input.timeZone),
    name: input.food.name,
    quantity: input.food.quantity,
    kcalMilli: milli(input.food.nutrients.kcal),
    proteinMilli: milli(input.food.nutrients.proteinG),
    carbsMilli: milli(input.food.nutrients.carbsG),
    fatMilli: milli(input.food.nutrients.fatG),
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

  return createHash("sha256").update(JSON.stringify(request)).digest("hex");
}

function resolveInput(input: FoodSubmission): FoodInput | null {
  return isCatalogInput(input)
    ? resolveFood(input.food.ref, input.food.quantity.amount, input.occurredAt, input.timeZone)
    : input;
}

async function missingOrStale(tx: Transaction, userId: string, id: string): Promise<{ outcome: "missing" | "stale" }> {
  const [row] = await tx.select({ id: foodEntries.id }).from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id), isNull(foodEntries.deletedAt)));

  return { outcome: row ? "stale" : "missing" };
}

// Logs recorded foods at one time, in the order given. Copies the saved name, amount, nutrients and
// catalog reference, never the catalog's current values, so it keeps working after the catalog changes.
export async function insertFoods(tx: Transaction, userId: string, when: Pick<RepeatInput, "occurredAt" | "timeZone">, foods: RecordedFood[]): Promise<FoodEntry[]> {
  const rows = foods.map((food) => ({ id: randomUUID(), userId, ...values({ ...when, food: manualFood(food) }) }));
  const inserted = await tx.insert(foodEntries).values(rows).returning();
  const byId = new Map(inserted.map((row) => [row.id, entry(row)]));

  return rows.map(({ id }) => {
    const created = byId.get(id);

    if (!created) throw new Error("Food insert returned no row");

    return created;
  });
}

// A food to log: as recorded, or a catalog food at an amount in grams.
export type FoodItem = RecordedFood | { ref: CatalogSelection; grams: number };

// Logs several foods at one time in one transaction, so an unknown catalog food logs none of them.
export async function logFoods(db: AppDatabase, userId: string, when: Pick<RepeatInput, "occurredAt" | "timeZone">, items: FoodItem[]): Promise<{ outcome: "created"; entries: FoodEntry[] } | { outcome: "catalog-missing" }> {
  const foods: RecordedFood[] = [];

  for (const item of items) {
    if (!("ref" in item)) {
      foods.push(item);
      continue;
    }

    const resolved = resolveFood(item.ref, item.grams, when.occurredAt, when.timeZone);

    if (!resolved) return { outcome: "catalog-missing" };
    foods.push({ ...resolved.food, catalogRef: resolved.food.catalogRef ?? null });
  }

  return { outcome: "created", entries: await db.transaction((tx) => insertFoods(tx, userId, when, foods)) };
}

// The person's current foods among these entries, by entry id. Deleted and unknown ids are absent.
export async function recordedFoods(tx: Transaction, userId: string, ids: string[]): Promise<Map<string, RecordedFood>> {
  const rows = await tx.select().from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), inArray(foodEntries.id, ids), isNull(foodEntries.deletedAt)));

  return new Map(rows.map((row) => [row.id, entry(row).food]));
}

// Copies the recorded food, scaled when an amount is given. A scaled food must still fit the journal's limits.
async function repeat(tx: Transaction, userId: string, sourceId: string, { amount, ...when }: RepeatInput): Promise<FoodMutationResult> {
  const recorded = (await recordedFoods(tx, userId, [sourceId])).get(sourceId);

  if (!recorded) return { outcome: "missing" };
  const food = amount === undefined ? recorded : scaledFood(recorded, amount);

  if (!food) return { outcome: "invalid-amount" };
  const [created] = await insertFoods(tx, userId, when, [food]);

  if (!created) throw new Error("Food insert returned no row");

  return { outcome: "created", entry: created };
}

async function insert(tx: Transaction, userId: string, input: FoodInput): Promise<{ outcome: "created"; entry: FoodEntry }> {
  const [row] = await tx.insert(foodEntries).values({ id: randomUUID(), userId, ...values(input) }).returning();

  if (!row) throw new Error("Food insert returned no row");

  return { outcome: "created", entry: entry(row) };
}

async function update(tx: Transaction, userId: string, id: string, revision: number, input: FoodInput): Promise<FoodMutationResult> {
  const [row] = await tx.update(foodEntries)
    .set({ ...values(input), revision: sql`${foodEntries.revision} + 1`, updatedAt: new Date() })
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id), eq(foodEntries.revision, revision), isNull(foodEntries.deletedAt)))
    .returning();

  return row ? { outcome: "updated", entry: entry(row) } : missingOrStale(tx, userId, id);
}

export async function mutateFood(db: AppDatabase, userId: string, key: string, command: FoodCommand): Promise<FoodMutationResult> {
  const requestHash = hash(command);

  return withReceipt(db, userId, key, requestHash, (receipt): FoodMutationResult => {
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
  const total = (pick: (row: NutrientRow) => number | null): number | null => {
    if (rows.length === 0) return null;
    let sum = 0;

    for (const row of rows) {
      const value = pick(row);

      if (value === null) return null;
      sum += value;
    }

    return sum / 1000;
  };

  return {
    kcal: total((row) => row.kcalMilli),
    proteinG: total((row) => row.proteinMilli),
    carbsG: total((row) => row.carbsMilli),
    fatG: total((row) => row.fatMilli),
  };
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
