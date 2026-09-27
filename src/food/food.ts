import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AppDatabase, Transaction } from "../db/database.js";
import { softDelete } from "../journal/records.js";
import { withReceipt } from "../journal/receipt.js";
import { foodEntries } from "../db/schema.js";
import { localDate } from "../time.js";
import { resolveFood } from "./catalog.js";
import { entrySchema } from "./contract.js";
import type { CatalogFoodInput, FoodEntry, FoodInput, FoodSubmission, RepeatInput } from "./contract.js";

export type { FoodEntry, FoodInput } from "./contract.js";

export type FoodCommand =
  | { kind: "create"; input: FoodSubmission }
  | { kind: "edit"; id: string; revision: number; input: FoodSubmission }
  | { kind: "repeat"; sourceId: string; input: RepeatInput }
  | { kind: "delete"; id: string; revision: number };

export type FoodMutationResult =
  | { outcome: "created" | "updated"; entry: FoodEntry }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" }
  | { outcome: "catalog-missing" };

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

async function insert(tx: Transaction, userId: string, input: FoodInput): Promise<{ outcome: "created"; entry: FoodEntry }> {
  const [row] = await tx.insert(foodEntries).values({ id: randomUUID(), userId, ...values(input) }).returning();

  if (!row) throw new Error("Food insert returned no row");

  return { outcome: "created", entry: entry(row) };
}

// Copies the saved name, amount, nutrients and catalog reference, never the catalog's current values.
async function sourceInput(tx: Transaction, userId: string, sourceId: string, input: RepeatInput): Promise<FoodInput | null> {
  const [source] = await tx.select().from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, sourceId), isNull(foodEntries.deletedAt)));

  if (!source) return null;
  const { catalogRef, ...food } = entry(source).food;

  return { ...input, food: catalogRef ? { ...food, catalogRef } : food };
}

export async function mutateFood(db: AppDatabase, userId: string, key: string, command: FoodCommand): Promise<FoodMutationResult> {
  const requestHash = hash(command);

  return withReceipt(db, userId, key, requestHash, (receipt): FoodMutationResult => {
    const { outcome, body } = receipt;

    if (outcome === null) throw new Error("Incomplete receipt cannot be replayed");

    if (outcome === "created" || outcome === "updated") return { outcome, entry: entrySchema.parse(body) };

    return { outcome };
  }, async (tx): Promise<FoodMutationResult> => {
    let result: Exclude<FoodMutationResult, { outcome: "catalog-missing" }>;

    if (command.kind === "delete") {
      result = await softDelete(tx, foodEntries, userId, command.id, command.revision, undefined);
    } else if (command.kind === "repeat") {
      const input = await sourceInput(tx, userId, command.sourceId, command.input);

      result = input ? await insert(tx, userId, input) : { outcome: "missing" };
    } else {
      const input = resolveInput(command.input);

      if (!input) {
        return { outcome: "catalog-missing" };
      }

      if (command.kind === "create") {
        result = await insert(tx, userId, input);
      } else {
        const [row] = await tx.update(foodEntries)
          .set({ ...values(input), revision: sql`${foodEntries.revision} + 1`, updatedAt: new Date() })
          .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, command.id), eq(foodEntries.revision, command.revision), isNull(foodEntries.deletedAt)))
          .returning();

        result = row ? { outcome: "updated", entry: entry(row) } : await missingOrStale(tx, userId, command.id);
      }
    }

    return result;
  }, "catalog-missing");
}

export async function getFoodDay(db: AppDatabase, userId: string, date: string) {
  const rows = await db.select().from(foodEntries).where(and(
    eq(foodEntries.userId, userId), eq(foodEntries.localDate, date), isNull(foodEntries.deletedAt),
  )).orderBy(foodEntries.occurredAt, foodEntries.id);

  const total = (pick: (row: FoodRow) => number | null): number | null => {
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
    date,
    food: {
      entries: rows.map(entry),
      entryCount: rows.length,
      totals: {
        kcal: total((row) => row.kcalMilli),
        proteinG: total((row) => row.proteinMilli),
        carbsG: total((row) => row.carbsMilli),
        fatG: total((row) => row.fatMilli),
      },
    },
  };
}
