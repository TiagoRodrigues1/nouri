import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
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
  table: waterEntries,
  schema: waterEntrySchema,
  create: async (tx, userId, input) => {
    const [row] = await tx.insert(waterEntries).values({
      id: randomUUID(), userId, occurredAt: new Date(input.occurredAt),
      timeZone: input.timeZone, localDate: localDate(input.occurredAt, input.timeZone),
      volumeMl: input.volumeMl,
    }).returning();

    if (!row) throw new Error("Water insert returned no row");

    return entry(row);
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
