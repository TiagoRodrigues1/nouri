import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { dailyActivity, dailyHeartRate, sleepSessions, workouts } from "../db/schema.js";
import type { AppDatabase, Transaction } from "../db/database.js";
import { importKinds } from "./contract.js";
import type { ImportCounts, ImportKind, WearableProvider } from "./contract.js";
import type { ActivityRecord, HeartRateRecord, ImportRecords, Pull, SleepRecord, SyncWindow, WorkoutRecord } from "./provider.js";
import { bpmRangeColumns } from "../daily-totals/columns.js";

type Owner = { userId: string; provider: WearableProvider };

// One imported row as applyBatch sees it. A dead row is a soft-deleted session the provider may bring back.
type StoredImport = { key: string; fingerprint: string; live: boolean };

// How one kind's imports sit in their table, addressed by key within one owner's imports.
// The rules for applying a batch live in applyBatch, once.
type ImportStore<R> = {
  key: (record: R) => string;
  // Rows the batch names, dead or alive, plus live rows inside the window.
  existing: (tx: Transaction, owner: Owner, keys: string[], window: SyncWindow) => Promise<StoredImport[]>;
  insert: (tx: Transaction, owner: Owner, record: R) => Promise<void>;
  // Writes the record over the row and revives it if it was dead.
  replace: (tx: Transaction, owner: Owner, key: string, record: R) => Promise<void>;
  remove: (tx: Transaction, owner: Owner, keys: string[]) => Promise<void>;
  removeAll: (tx: Transaction, owner: Owner) => Promise<number>;
  countLive: (db: AppDatabase, owner: Owner) => Promise<number>;
};

const revise = { revision: sql`revision + 1`, updatedAt: sql`now()` };

const removal = { ...revise, deletedAt: sql`now()` };

type SessionTable = typeof sleepSessions | typeof workouts;

// Sessions keep the provider's ID and are soft-deleted, so one the provider restores revives its row.
// The source identity checks on both tables make source_id present on every imported row.
function sessionRows(table: SessionTable, owner: Owner) {
  const owned = and(eq(table.userId, owner.userId), eq(table.source, owner.provider));
  const live = isNull(table.deletedAt);

  return {
    owned,
    named: (keys: string[]) => and(owned, inArray(table.sourceId, keys)),
    live: and(owned, live),
    select: { key: sql<string>`${table.sourceId}`, fingerprint: sql<string>`${table.sourceFingerprint}`, live: sql<boolean>`${live}` },
  };
}

function sleepColumns(record: SleepRecord) {
  return {
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    timeZone: record.timeZone,
    localDate: record.localDate,
    awakeMinutes: record.stages?.awake ?? null,
    lightMinutes: record.stages?.light ?? null,
    deepMinutes: record.stages?.deep ?? null,
    remMinutes: record.stages?.rem ?? null,
    sourceFingerprint: record.fingerprint,
    sourceDevice: record.device,
  };
}

const sleepStore: ImportStore<SleepRecord> = {
  key: (record) => record.externalId,
  existing: (tx, owner, keys, window) => {
    const rows = sessionRows(sleepSessions, owner);

    return tx.select(rows.select).from(sleepSessions).where(or(keys.length > 0 ? rows.named(keys) : undefined, and(rows.live, gte(sleepSessions.endedAt, window.endedSince))));
  },
  insert: async (tx, owner, record) => {
    await tx.insert(sleepSessions).values({ id: randomUUID(), userId: owner.userId, source: owner.provider, sourceId: record.externalId, ...sleepColumns(record) });
  },
  replace: async (tx, owner, key, record) => {
    await tx.update(sleepSessions).set({ ...sleepColumns(record), ...revise, deletedAt: null }).where(sessionRows(sleepSessions, owner).named([key]));
  },
  remove: async (tx, owner, keys) => {
    await tx.update(sleepSessions).set(removal).where(sessionRows(sleepSessions, owner).named(keys));
  },
  removeAll: async (tx, owner) => (await tx.update(sleepSessions).set(removal).where(sessionRows(sleepSessions, owner).live).returning({ id: sleepSessions.id })).length,
  countLive: async (db, owner) => (await db.select({ value: count() }).from(sleepSessions).where(sessionRows(sleepSessions, owner).live))[0]?.value ?? 0,
};

function workoutColumns(record: WorkoutRecord) {
  return {
    occurredAt: record.occurredAt,
    timeZone: record.timeZone,
    localDate: record.localDate,
    activity: record.activity,
    durationMinutes: record.durationMinutes,
    distanceM: record.distanceM,
    energyKcal: record.energyKcal,
    strengthExercises: null,
    sourceFingerprint: record.fingerprint,
    sourceDevice: record.device,
    sourceTitle: record.title,
  };
}

const workoutStore: ImportStore<WorkoutRecord> = {
  key: (record) => record.externalId,
  existing: (tx, owner, keys, window) => {
    const rows = sessionRows(workouts, owner);

    return tx.select(rows.select).from(workouts).where(or(keys.length > 0 ? rows.named(keys) : undefined, and(rows.live, gte(workouts.localDate, window.days.from))));
  },
  insert: async (tx, owner, record) => {
    await tx.insert(workouts).values({ id: randomUUID(), userId: owner.userId, source: owner.provider, sourceId: record.externalId, ...workoutColumns(record) });
  },
  replace: async (tx, owner, key, record) => {
    await tx.update(workouts).set({ ...workoutColumns(record), ...revise, deletedAt: null }).where(sessionRows(workouts, owner).named([key]));
  },
  remove: async (tx, owner, keys) => {
    await tx.update(workouts).set(removal).where(sessionRows(workouts, owner).named(keys));
  },
  removeAll: async (tx, owner) => (await tx.update(workouts).set(removal).where(sessionRows(workouts, owner).live).returning({ id: workouts.id })).length,
  countLive: async (db, owner) => (await db.select({ value: count() }).from(workouts).where(sessionRows(workouts, owner).live))[0]?.value ?? 0,
};

type DailyTable = typeof dailyActivity | typeof dailyHeartRate;

// A daily table's own value columns. The store factory checks them against its table, so a store writes only columns its table has.
type DailyValues<T extends DailyTable> = Omit<T["$inferInsert"], "userId" | "localDate" | "source" | "sourceFingerprint" | "updatedAt">;

type AnyDailyValues = DailyValues<typeof dailyActivity> | DailyValues<typeof dailyHeartRate>;

// Daily totals are keyed by their local date and removed outright: nothing refers to them, and a day the
// provider brings back is inserted again. `values` gives the table's own columns for a record.
function dailyStore<R extends ActivityRecord | HeartRateRecord, T extends DailyTable>(of: T, values: (record: R) => DailyValues<T>): ImportStore<R> {
  // Drizzle's query builders take a concrete table, not a type parameter.
  const table: DailyTable = of;
  const owned = ({ userId, provider }: Owner) => and(eq(table.userId, userId), eq(table.source, provider));
  const own: (record: R) => AnyDailyValues = values;
  const columns = (record: R) => ({ ...own(record), sourceFingerprint: record.fingerprint });

  return {
    key: (record) => record.localDate,
    existing: (tx, owner, days, window) => tx.select({ key: table.localDate, fingerprint: table.sourceFingerprint, live: sql<boolean>`true` }).from(table).where(and(owned(owner), or(
      days.length > 0 ? inArray(table.localDate, days) : undefined,
      and(gte(table.localDate, window.days.from), lt(table.localDate, window.days.until)),
    ))),
    insert: async (tx, owner, record) => {
      await tx.insert(table).values({ userId: owner.userId, source: owner.provider, localDate: record.localDate, ...columns(record) });
    },
    replace: async (tx, owner, day, record) => {
      await tx.update(table).set({ ...columns(record), updatedAt: sql`now()` }).where(and(owned(owner), eq(table.localDate, day)));
    },
    remove: async (tx, owner, days) => {
      await tx.delete(table).where(and(owned(owner), inArray(table.localDate, days)));
    },
    removeAll: async (tx, owner) => (await tx.delete(table).where(owned(owner)).returning({ day: table.localDate })).length,
    countLive: async (db, owner) => (await db.select({ value: count() }).from(table).where(owned(owner)))[0]?.value ?? 0,
  };
}

const activityStore = dailyStore(dailyActivity, (record: ActivityRecord) => ({ steps: record.steps, activeKcal: record.activeKcal }));

const heartRateStore = dailyStore(dailyHeartRate, (record: HeartRateRecord) => ({ restingBpm: record.restingBpm, ...bpmRangeColumns(record.range) }));

// Each kind's store takes that kind's records, so applyBatch can pick one by kind.
type ImportStores = { [K in ImportKind]: ImportStore<ImportRecords[K]> };

const stores: ImportStores = { sleep: sleepStore, workouts: workoutStore, activity: activityStore, heartRate: heartRateStore };

// Makes Nouri's copy of one provider's records of one kind match what the batch says, keyed within (user, provider).
// The batch holds the records inside the window. A repeated batch changes nothing, an edit updates the row,
// and a record missing from a complete batch is removed. A dead row revives in place if the provider brings it back.
// The caller serializes batches per user and provider.
export async function applyBatch<K extends ImportKind>(tx: Transaction, kind: K, owner: Owner, window: SyncWindow, batch: Pull<ImportRecords[K]>): Promise<ImportCounts> {
  const store: ImportStore<ImportRecords[K]> = stores[kind];
  const counts = { created: 0, updated: 0, removed: 0, skipped: batch.skipped };
  const keys = batch.records.map(store.key);
  const existing = await store.existing(tx, owner, keys, window);
  const byKey = new Map(existing.map((row) => [row.key, row]));

  for (const record of batch.records) {
    const key = store.key(record);
    const row = byKey.get(key);

    if (!row) {
      await store.insert(tx, owner, record);
      counts.created += 1;
    } else if (!row.live || row.fingerprint !== record.fingerprint) {
      await store.replace(tx, owner, key, record);

      if (row.live) counts.updated += 1;
      else counts.created += 1;
    }
  }

  if (batch.complete) {
    // A snapshot infers deletion from absence, so it only removes anything when the provider returned the whole window.
    const seen = new Set(keys);
    const gone = existing.flatMap((row) => row.live && !seen.has(row.key) ? [row.key] : []);

    if (gone.length > 0) {
      await store.remove(tx, owner, gone);
      counts.removed = gone.length;
    }
  }

  return counts;
}

// Runs one step per import kind in turn and keys the results by kind, so a transaction never has two queries in flight.
export async function eachKind<T>(run: (kind: ImportKind) => Promise<T>): Promise<Record<ImportKind, T>> {
  const results: [ImportKind, T][] = [];

  for (const kind of importKinds) results.push([kind, await run(kind)]);

  // SAFETY: results holds one entry for every import kind.
  return Object.fromEntries(results) as Record<ImportKind, T>;
}

// Used when a person disconnects a provider: its imports leave the journal.
export function removeImports(tx: Transaction, owner: Owner): Promise<Record<ImportKind, number>> {
  return eachKind((kind) => stores[kind].removeAll(tx, owner));
}

export function countImports(db: AppDatabase, owner: Owner): Promise<Record<ImportKind, number>> {
  return eachKind((kind) => stores[kind].countLive(db, owner));
}
