import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { foodEntries, mutationReceipts } from "../db/schema.js";
import { resolveFood } from "./catalog.js";
import type { CatalogFoodInput, FoodEntry, FoodInput, FoodSubmission } from "./contract.js";

export type { FoodEntry, FoodInput } from "./contract.js";

export type FoodCommand =
  | { kind: "create"; input: FoodSubmission }
  | { kind: "edit"; id: string; revision: number; input: FoodSubmission }
  | { kind: "delete"; id: string; revision: number };

export type FoodMutationResult =
  | { outcome: "created" | "updated"; entry: FoodEntry }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" }
  | { outcome: "catalog-missing" };

export type FoodDatabase = PostgresJsDatabase<Record<string, never>>;

type FoodRow = typeof foodEntries.$inferSelect;

function localDate(instant: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) throw new Error("Could not calculate local date");

  return `${year}-${month}-${day}`;
}

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
  if (command.kind !== "delete" && isCatalogInput(command.input)) {
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

async function missingOrStale(tx: Parameters<Parameters<FoodDatabase["transaction"]>[0]>[0], userId: string, id: string): Promise<{ outcome: "missing" | "stale" }> {
  const [row] = await tx.select({ id: foodEntries.id }).from(foodEntries)
    .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, id), isNull(foodEntries.deletedAt)));

  return { outcome: row ? "stale" : "missing" };
}

export async function mutateFood(db: FoodDatabase, userId: string, key: string, command: FoodCommand): Promise<FoodMutationResult> {
  const requestHash = hash(command);

  return db.transaction(async (tx) => {
    await tx.insert(mutationReceipts).values({ userId, key, requestHash }).onConflictDoNothing();

    const [receipt] = await tx.select().from(mutationReceipts)
      .where(and(eq(mutationReceipts.userId, userId), eq(mutationReceipts.key, key))).for("update");

    if (!receipt) throw new Error("Receipt missing after insert");

    if (receipt.requestHash !== requestHash) return { outcome: "key-reuse" };

    if (receipt.outcome === "created" || receipt.outcome === "updated") {
      if (receipt.body === null) throw new Error("Completed receipt has no entry");

      return { outcome: receipt.outcome, entry: receipt.body };
    }

    if (receipt.outcome !== null) return { outcome: receipt.outcome };

    let result: Exclude<FoodMutationResult, { outcome: "catalog-missing" }>;

    if (command.kind === "delete") {
      const [row] = await tx.update(foodEntries)
        .set({ revision: sql`${foodEntries.revision} + 1`, deletedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, command.id), eq(foodEntries.revision, command.revision), isNull(foodEntries.deletedAt)))
        .returning({ id: foodEntries.id });

      result = row ? { outcome: "deleted" } : await missingOrStale(tx, userId, command.id);
    } else {
      const input = resolveInput(command.input);

      if (!input) {
        await tx.delete(mutationReceipts).where(and(eq(mutationReceipts.userId, userId), eq(mutationReceipts.key, key)));

        return { outcome: "catalog-missing" };
      }

      if (command.kind === "create") {
        const [row] = await tx.insert(foodEntries).values({ id: randomUUID(), userId, ...values(input) }).returning();

        if (!row) throw new Error("Food insert returned no row");
        result = { outcome: "created", entry: entry(row) };
      } else {
        const [row] = await tx.update(foodEntries)
          .set({ ...values(input), revision: sql`${foodEntries.revision} + 1`, updatedAt: new Date() })
          .where(and(eq(foodEntries.userId, userId), eq(foodEntries.id, command.id), eq(foodEntries.revision, command.revision), isNull(foodEntries.deletedAt)))
          .returning();

        result = row ? { outcome: "updated", entry: entry(row) } : await missingOrStale(tx, userId, command.id);
      }
    }

    const body = result.outcome === "created" || result.outcome === "updated" ? result.entry : null;
    await tx.update(mutationReceipts).set({ outcome: result.outcome, body })
      .where(and(eq(mutationReceipts.userId, userId), eq(mutationReceipts.key, key)));

    return result;
  });
}

export async function getFoodDay(db: FoodDatabase, userId: string, date: string) {
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
