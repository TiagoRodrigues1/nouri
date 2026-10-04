import { randomUUID } from "node:crypto";
import { and, count, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { sleepSessions, workouts } from "../db/schema.js";
import type { AppDatabase, Transaction } from "../db/database.js";
import { importKinds } from "./contract.js";
import type { ImportCounts, ImportKind, WearableProvider } from "./contract.js";
import type { ImportRecords, Pull, SleepRecord, SyncWindow, WorkoutRecord } from "./provider.js";

type Owner = { userId: string; provider: WearableProvider };

type StoredImport = { id: string; externalId: string | null; fingerprint: string | null; deletedAt: Date | null };

// How one kind's imports sit in their journal table. The rules for applying a batch live in applyBatch, once.
type ImportStore<R> = {
  // Rows the batch names, deleted or not, plus live rows inside the window.
  existing: (tx: Transaction, owner: Owner, externalIds: string[], window: SyncWindow) => Promise<StoredImport[]>;
  insert: (tx: Transaction, owner: Owner, record: R) => Promise<void>;
  // Writes the record over the row, bumps its revision, and revives it if it was deleted.
  replace: (tx: Transaction, id: string, record: R) => Promise<void>;
  remove: (tx: Transaction, ids: string[]) => Promise<void>;
  removeAll: (tx: Transaction, owner: Owner) => Promise<number>;
  countLive: (db: AppDatabase, owner: Owner) => Promise<number>;
};

const revise = { revision: sql`revision + 1`, updatedAt: sql`now()` };

const removal = { ...revise, deletedAt: sql`now()` };

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

const importedSleep = ({ userId, provider }: Owner) => and(eq(sleepSessions.userId, userId), eq(sleepSessions.source, provider));

const sleepStore: ImportStore<SleepRecord> = {
  existing: (tx, owner, externalIds, window) => tx.select({
    id: sleepSessions.id, externalId: sleepSessions.sourceId, fingerprint: sleepSessions.sourceFingerprint, deletedAt: sleepSessions.deletedAt,
  }).from(sleepSessions).where(and(importedSleep(owner), or(
    externalIds.length > 0 ? inArray(sleepSessions.sourceId, externalIds) : undefined,
    and(isNull(sleepSessions.deletedAt), gte(sleepSessions.endedAt, window.endedSince)),
  ))),
  insert: async (tx, owner, record) => {
    await tx.insert(sleepSessions).values({ id: randomUUID(), userId: owner.userId, source: owner.provider, sourceId: record.externalId, ...sleepColumns(record) });
  },
  replace: async (tx, id, record) => {
    await tx.update(sleepSessions).set({ ...sleepColumns(record), ...revise, deletedAt: null }).where(eq(sleepSessions.id, id));
  },
  remove: async (tx, ids) => {
    await tx.update(sleepSessions).set(removal).where(inArray(sleepSessions.id, ids));
  },
  removeAll: async (tx, owner) => (await tx.update(sleepSessions).set(removal).where(and(importedSleep(owner), isNull(sleepSessions.deletedAt))).returning({ id: sleepSessions.id })).length,
  countLive: async (db, owner) => (await db.select({ value: count() }).from(sleepSessions).where(and(importedSleep(owner), isNull(sleepSessions.deletedAt))))[0]?.value ?? 0,
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

const importedWorkouts = ({ userId, provider }: Owner) => and(eq(workouts.userId, userId), eq(workouts.source, provider));

const workoutStore: ImportStore<WorkoutRecord> = {
  existing: (tx, owner, externalIds, window) => tx.select({
    id: workouts.id, externalId: workouts.sourceId, fingerprint: workouts.sourceFingerprint, deletedAt: workouts.deletedAt,
  }).from(workouts).where(and(importedWorkouts(owner), or(
    externalIds.length > 0 ? inArray(workouts.sourceId, externalIds) : undefined,
    and(isNull(workouts.deletedAt), gte(workouts.localDate, window.startedOnOrAfter)),
  ))),
  insert: async (tx, owner, record) => {
    await tx.insert(workouts).values({ id: randomUUID(), userId: owner.userId, source: owner.provider, sourceId: record.externalId, ...workoutColumns(record) });
  },
  replace: async (tx, id, record) => {
    await tx.update(workouts).set({ ...workoutColumns(record), ...revise, deletedAt: null }).where(eq(workouts.id, id));
  },
  remove: async (tx, ids) => {
    await tx.update(workouts).set(removal).where(inArray(workouts.id, ids));
  },
  removeAll: async (tx, owner) => (await tx.update(workouts).set(removal).where(and(importedWorkouts(owner), isNull(workouts.deletedAt))).returning({ id: workouts.id })).length,
  countLive: async (db, owner) => (await db.select({ value: count() }).from(workouts).where(and(importedWorkouts(owner), isNull(workouts.deletedAt))))[0]?.value ?? 0,
};

// Each kind's store takes that kind's records, so applyBatch can pick one by kind.
type ImportStores = { [K in ImportKind]: ImportStore<ImportRecords[K]> };

const stores: ImportStores = { sleep: sleepStore, workouts: workoutStore };

// Makes Nouri's copy of one provider's records of one kind match what the batch says, keyed by (user, provider, external ID).
// The batch holds the records inside the window. A repeated batch changes nothing; an edit bumps the Nouri
// revision; a deleted record is soft-deleted and revives in place if the provider brings it back.
// The caller serializes batches per user and provider.
export async function applyBatch<K extends ImportKind>(tx: Transaction, kind: K, owner: Owner, window: SyncWindow, batch: Pull<ImportRecords[K]>): Promise<ImportCounts> {
  const store: ImportStore<ImportRecords[K]> = stores[kind];
  const counts = { created: 0, updated: 0, removed: 0, skipped: batch.skipped };
  const named = batch.records.map((record) => record.externalId);
  const existing = await store.existing(tx, owner, named, window);
  const byExternalId = new Map(existing.map((row) => [row.externalId, row]));

  for (const record of batch.records) {
    const row = byExternalId.get(record.externalId);

    if (!row) {
      await store.insert(tx, owner, record);
      counts.created += 1;
    } else if (row.deletedAt !== null || row.fingerprint !== record.fingerprint) {
      await store.replace(tx, row.id, record);

      if (row.deletedAt === null) counts.updated += 1;
      else counts.created += 1;
    }
  }

  if (batch.complete) {
    // A snapshot infers deletion from absence, so it only removes anything when the provider returned the whole window.
    const seen = new Set(named);
    const gone = existing.flatMap((row) => row.deletedAt === null && row.externalId !== null && !seen.has(row.externalId) ? [row.id] : []);

    if (gone.length > 0) {
      await store.remove(tx, gone);
      counts.removed = gone.length;
    }
  }

  return counts;
}

// Runs one step per import kind and keys the results by kind. Inside a transaction the queries still run one at a time.
export async function eachKind<T>(run: (kind: ImportKind) => Promise<T>): Promise<Record<ImportKind, T>> {
  const results = await Promise.all(importKinds.map(async (kind) => [kind, await run(kind)] as const));

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
