import { randomUUID } from "node:crypto";
import { and, between, count, eq, isNull, sum } from "drizzle-orm";
import { waterEntries } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import type { RecordKind } from "../journal/records.js";
import { localDate } from "../time.js";
import { waterEntrySchema } from "./contract.js";
import type { WaterDay, WaterEntry, WaterInput } from "./contract.js";

type WaterRow = typeof waterEntries.$inferSelect;

function entry(row: WaterRow): WaterEntry {
  return {
    id: row.id,
    revision: row.revision,
    occurredAt: row.occurredAt.toISOString(),
    timeZone: row.timeZone,
    localDate: row.localDate,
    volumeMl: row.volumeMl,
  };
}

export const waterRecords: RecordKind<WaterInput, WaterEntry> = {
  name: "water",
  label: "Water entry",
  table: waterEntries,
  schema: waterEntrySchema,
  create: async (tx, userId, input) => {
    const [row] = await tx.insert(waterEntries).values({
      id: randomUUID(), userId, occurredAt: new Date(input.occurredAt),
      timeZone: input.timeZone, localDate: localDate(input.occurredAt, input.timeZone),
      volumeMl: input.volumeMl,
    }).returning();

    if (!row) throw new Error("Water insert returned no row");

    return { outcome: "created", entry: entry(row) };
  },
};

export async function getWaterDay(db: AppDatabase, userId: string, date: string): Promise<WaterDay> {
  const rows = await db.select().from(waterEntries).where(and(
    eq(waterEntries.userId, userId), eq(waterEntries.localDate, date), isNull(waterEntries.deletedAt),
  )).orderBy(waterEntries.occurredAt, waterEntries.id);

  return {
    entries: rows.map(entry),
    entryCount: rows.length,
    // An empty day is unrecorded intake, not zero millilitres.
    totalMl: rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.volumeMl, 0),
  };
}

export type WaterRangeDay = { entryCount: number; totalMl: number };

// Days from `from` to `to` that have water, by local date.
export async function getWaterRange(db: AppDatabase, userId: string, from: string, to: string): Promise<Map<string, WaterRangeDay>> {
  const rows = await db.select({ localDate: waterEntries.localDate, entryCount: count(), totalMl: sum(waterEntries.volumeMl) }).from(waterEntries).where(and(
    eq(waterEntries.userId, userId), between(waterEntries.localDate, from, to), isNull(waterEntries.deletedAt),
  )).groupBy(waterEntries.localDate);

  return new Map(rows.map((row) => [row.localDate, { entryCount: row.entryCount, totalMl: Number(row.totalMl) }]));
}
