import { randomUUID } from "node:crypto";
import { and, between, eq, isNull } from "drizzle-orm";
import { sleepSessions } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { recordEdit, type RecordKind } from "../journal/records.js";
import { localDate } from "../time.js";
import { sleepInputSchema, sleepSessionSchema } from "./contract.js";
import type { SleepDay, SleepInput, SleepSession, Stages } from "./contract.js";

type SleepRow = typeof sleepSessions.$inferSelect;

function stages(row: SleepRow): Stages | null {
  const { awakeMinutes, lightMinutes, deepMinutes, remMinutes } = row;

  if (awakeMinutes === null || lightMinutes === null || deepMinutes === null || remMinutes === null) return null;

  return { awake: awakeMinutes, light: lightMinutes, deep: deepMinutes, rem: remMinutes };
}

function source(row: SleepRow): SleepSession["source"] {
  if (row.source === "manual") return { kind: "manual" };

  return {
    kind: "wearable",
    provider: row.source,
    device: row.sourceDevice,
  };
}

function minutes(row: Pick<SleepRow, "startedAt" | "endedAt">): number {
  return Math.round((row.endedAt.getTime() - row.startedAt.getTime()) / 60_000);
}

function session(row: SleepRow): SleepSession {
  return {
    id: row.id,
    revision: row.revision,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt.toISOString(),
    timeZone: row.timeZone,
    localDate: row.localDate,
    durationMinutes: minutes(row),
    stages: stages(row),
    source: source(row),
  };
}

// The row values an input sets, on create and edit alike.
function values(input: SleepInput) {
  return {
    startedAt: new Date(input.startedAt),
    endedAt: new Date(input.endedAt),
    timeZone: input.timeZone,
    // A night belongs to the morning it ends on.
    localDate: localDate(input.endedAt, input.timeZone),
    awakeMinutes: input.stages?.awake ?? null,
    lightMinutes: input.stages?.light ?? null,
    deepMinutes: input.stages?.deep ?? null,
    remMinutes: input.stages?.rem ?? null,
  };
}

export const sleepRecords: RecordKind<SleepInput, SleepSession> = {
  name: "sleep",
  label: "Sleep session",
  table: sleepSessions,
  schema: sleepSessionSchema,
  // Imported rows are outside the manual delete and edit paths. Their provider owns them.
  deletable: eq(sleepSessions.source, "manual"),
  edit: recordEdit(sleepSessions, {
    input: sleepInputSchema,
    inputOf: ({ startedAt, endedAt, timeZone, stages }) => ({ startedAt, endedAt, timeZone, stages }),
    entry: session,
    values: async (_tx, _userId, input) => values(input),
  }),
  create: async (tx, userId, input) => {
    const [row] = await tx.insert(sleepSessions).values({ id: randomUUID(), userId, ...values(input) }).returning();

    if (!row) throw new Error("Sleep insert returned no row");

    return { outcome: "created", entry: session(row) };
  },
};

// Null unless every session has stages, so a partial breakdown is never shown as the night's.
function sumStages(sessions: SleepSession[]): Stages | null {
  if (sessions.length === 0) return null;
  const total: Stages = { awake: 0, light: 0, deep: 0, rem: 0 };

  for (const { stages: part } of sessions) {
    if (!part) return null;
    total.awake += part.awake;
    total.light += part.light;
    total.deep += part.deep;
    total.rem += part.rem;
  }

  return total;
}

export async function getSleepDay(db: AppDatabase, userId: string, date: string): Promise<SleepDay> {
  const rows = await db.select().from(sleepSessions).where(and(
    eq(sleepSessions.userId, userId), eq(sleepSessions.localDate, date), isNull(sleepSessions.deletedAt),
  )).orderBy(sleepSessions.startedAt, sleepSessions.id);

  const sessions = rows.map(session);

  return {
    sessions,
    totalMinutes: sessions.length === 0 ? null : sessions.reduce((sum, item) => sum + item.durationMinutes, 0),
    stages: sumStages(sessions),
  };
}

export type SleepRangeDay = { sessionCount: number; totalMinutes: number };

// Days from `from` to `to` that have sleep, by the local date each night ends on.
export async function getSleepRange(db: AppDatabase, userId: string, from: string, to: string): Promise<Map<string, SleepRangeDay>> {
  const rows = await db.select({ localDate: sleepSessions.localDate, startedAt: sleepSessions.startedAt, endedAt: sleepSessions.endedAt }).from(sleepSessions).where(and(
    eq(sleepSessions.userId, userId), between(sleepSessions.localDate, from, to), isNull(sleepSessions.deletedAt),
  ));

  const days = new Map<string, SleepRangeDay>();

  for (const row of rows) {
    const day = days.get(row.localDate) ?? { sessionCount: 0, totalMinutes: 0 };

    day.sessionCount += 1;
    day.totalMinutes += minutes(row);
    days.set(row.localDate, day);
  }

  return days;
}
