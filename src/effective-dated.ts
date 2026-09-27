import { and, desc, eq, lte } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { AppDatabase, Transaction } from "./db/database.js";

export type DatedTable = PgTable & { userId: PgColumn; effectiveFrom: PgColumn };

// A value that changes over time: a saved row is in force from its date until the next saved date.
export type DatedKind<T extends DatedTable, Input, Result> = {
  table: T;
  input: z.ZodType<Input>;
  schema: z.ZodType<Result>;
  // What a day reads before anything has been saved.
  empty: Result;
  toResult: (row: T["$inferSelect"]) => Result;
  values: (input: Input) => Partial<T["$inferInsert"]>;
};

export async function getDated<T extends DatedTable, Input, Result>(db: AppDatabase | Transaction, kind: DatedKind<T, Input, Result>, userId: string, date: string): Promise<Result> {
  const { table } = kind;
  const source: PgTable = table;

  const [row] = await db.select().from(source)
    .where(and(eq(table.userId, userId), lte(table.effectiveFrom, date)))
    .orderBy(desc(table.effectiveFrom)).limit(1);

  return row ? kind.toResult(row) : kind.empty;
}

// A full replacement of the value taking effect on that day, so repeating it changes nothing.
export async function saveDated<T extends DatedTable, Input, Result>(db: AppDatabase, kind: DatedKind<T, Input, Result>, userId: string, effectiveFrom: string, input: Input): Promise<Result> {
  const { table } = kind;
  const values = { ...kind.values(input), updatedAt: new Date() };

  const [row] = await db.insert(table).values({ userId, effectiveFrom, ...values })
    .onConflictDoUpdate({ target: [table.userId, table.effectiveFrom], set: values })
    .returning();

  if (!row) throw new Error("Saving dated value returned no row");

  return kind.toResult(row);
}
