import { randomUUID } from "node:crypto";
import { and, between, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { bodyMeasurements } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import type { RecordKind } from "../journal/records.js";
import { localDate, shiftDate } from "../time.js";
import { measurementKinds, measurementSchema } from "./contract.js";
import type { Measurement, MeasurementInput, MeasurementSummary } from "./contract.js";

type MeasurementRow = typeof bodyMeasurements.$inferSelect;

const historyDays = 30;

function measurement(row: MeasurementRow): Measurement {
  return {
    id: row.id,
    revision: row.revision,
    occurredAt: row.occurredAt.toISOString(),
    timeZone: row.timeZone,
    localDate: row.localDate,
    kind: row.kind,
    value: row.valueMilli / 1000,
  };
}

export const measurementRecords: RecordKind<MeasurementInput, Measurement> = {
  name: "measurement",
  label: "Measurement",
  table: bodyMeasurements,
  schema: measurementSchema,
  create: async (tx, userId, input) => {
    const [row] = await tx.insert(bodyMeasurements).values({
      id: randomUUID(),
      userId,
      occurredAt: new Date(input.occurredAt),
      timeZone: input.timeZone,
      localDate: localDate(input.occurredAt, input.timeZone),
      kind: input.kind,
      valueMilli: Math.round(input.value * 1000),
    }).returning();

    if (!row) throw new Error("Measurement insert returned no row");

    return { outcome: "created", entry: measurement(row) };
  },
};

// Measurements carry forward: the summary for a day shows the latest value recorded on or before it.
export async function getMeasurementSummary(db: AppDatabase, userId: string, date: string): Promise<MeasurementSummary> {
  const active = and(eq(bodyMeasurements.userId, userId), isNull(bodyMeasurements.deletedAt));
  const newestFirst = [desc(bodyMeasurements.occurredAt), desc(bodyMeasurements.id)];

  const [today, latestRows, recentWeights, historyRows] = await Promise.all([
    db.select().from(bodyMeasurements).where(and(active, eq(bodyMeasurements.localDate, date)))
      .orderBy(bodyMeasurements.occurredAt, bodyMeasurements.id),
    db.selectDistinctOn([bodyMeasurements.kind]).from(bodyMeasurements).where(and(active, lte(bodyMeasurements.localDate, date)))
      .orderBy(bodyMeasurements.kind, ...newestFirst),
    db.select().from(bodyMeasurements).where(and(active, eq(bodyMeasurements.kind, "weight"), lte(bodyMeasurements.localDate, date)))
      .orderBy(...newestFirst).limit(2),
    db.select().from(bodyMeasurements).where(and(
      active, eq(bodyMeasurements.kind, "weight"), lte(bodyMeasurements.localDate, date), gte(bodyMeasurements.localDate, shiftDate(date, 1 - historyDays)),
    )).orderBy(bodyMeasurements.occurredAt, bodyMeasurements.id),
  ]);

  const latest: MeasurementSummary["latest"] = { weight: null, height: null, "body-fat": null, waist: null };

  for (const kind of measurementKinds) {
    const row = latestRows.find((candidate) => candidate.kind === kind);

    latest[kind] = row ? { value: row.valueMilli / 1000, localDate: row.localDate } : null;
  }

  // One point per day: the last weight recorded that day.
  const history = new Map<string, number>();

  for (const row of historyRows) history.set(row.localDate, row.valueMilli / 1000);

  const [newest, previous] = recentWeights;
  const weight = latest.weight?.value;
  const heightM = latest.height ? latest.height.value / 100 : null;

  return {
    entries: today.map(measurement),
    latest,
    weightChange: newest && previous ? (newest.valueMilli - previous.valueMilli) / 1000 : null,
    weightHistory: [...history].map(([day, value]) => ({ localDate: day, value })),
    bmi: weight && heightM ? Math.round((weight / (heightM * heightM)) * 10) / 10 : null,
  };
}

// Days from `from` to `to` with a weight, by local date: the last weight recorded that day.
export async function getWeightRange(db: AppDatabase, userId: string, from: string, to: string): Promise<Map<string, number>> {
  const rows = await db.selectDistinctOn([bodyMeasurements.localDate]).from(bodyMeasurements).where(and(
    eq(bodyMeasurements.userId, userId), eq(bodyMeasurements.kind, "weight"), between(bodyMeasurements.localDate, from, to), isNull(bodyMeasurements.deletedAt),
  )).orderBy(bodyMeasurements.localDate, desc(bodyMeasurements.occurredAt), desc(bodyMeasurements.id));

  return new Map(rows.map((row) => [row.localDate, row.valueMilli / 1000]));
}
