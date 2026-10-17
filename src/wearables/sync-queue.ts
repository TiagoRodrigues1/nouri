import { and, asc, eq, gte, isNotNull, isNull, lte, min, or, sql, type SQL } from "drizzle-orm";
import { wearableConnections, wearableSyncJobs } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import type { SyncState, WearableProvider } from "./contract.js";
import { connectionFor, connectionKey, type SyncOutcome } from "./connections.js";
import { everything, type ChangeNotice, type CloudProvider, type SyncScope, type WearableRuntime } from "./provider.js";
import { syncTiming } from "./sync-timing.js";
import { shiftDate, utcDate } from "../time.js";

type Job = typeof wearableSyncJobs.$inferSelect;

export type SyncQueue = ReturnType<typeof syncQueue>;

// What the app needs for wearables: the providers and the queue their background imports share.
export type Wearables = { runtime: WearableRuntime; queue: SyncQueue };

const timestamp = (instant: Date) => sql`${instant.toISOString()}::timestamptz`;

const jobKey = (userId: string, provider: WearableProvider) => and(eq(wearableSyncJobs.userId, userId), eq(wearableSyncJobs.provider, provider));

const earliest = (a: string | null, b: string | null) => a === null || b === null ? null : a < b ? a : b;

export async function syncState(db: AppDatabase, provider: WearableProvider, userId: string): Promise<SyncState> {
  const [row] = await db.select({ lastSyncedAt: wearableConnections.lastSyncedAt, lastError: wearableConnections.lastError, attempts: wearableSyncJobs.attempts })
    .from(wearableConnections)
    .leftJoin(wearableSyncJobs, and(eq(wearableSyncJobs.userId, wearableConnections.userId), eq(wearableSyncJobs.provider, wearableConnections.provider)))
    .where(connectionKey(userId, provider));

  // A job waiting out a failure has attempts; lastError explains it, and the page stops waiting.
  return { pending: row?.attempts === 0, lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null, lastError: row?.lastError ?? null };
}

// What opening Nouri should import, or null when the stored imports are recent enough. Back from a long absence,
// or not reconciled for a day, it re-reads everything; otherwise it reads from a few days before the last sync.
function refreshScope(connection: { lastSyncedAt: Date | null; reconciledAt: Date | null }, now: Date, notified: boolean): SyncScope | null {
  const age = (instant: Date | null) => instant ? now.getTime() - instant.getTime() : Infinity;
  const { lastSyncedAt } = connection;

  if (age(lastSyncedAt) < (notified ? syncTiming.staleAfterMs.notified : syncTiming.staleAfterMs.unnotified)) return null;

  if (!lastSyncedAt || age(connection.reconciledAt) >= syncTiming.reconcileEveryMs) return everything;

  return { kinds: everything.kinds, since: shiftDate(utcDate(lastSyncedAt), -syncTiming.lateDays) };
}

// Equal jitter: between half and all of a delay that doubles with each failure, so retries do not line up.
function retryDelay(attempts: number): number {
  const ceiling = Math.min(syncTiming.retry.firstMs * 2 ** (attempts - 1), syncTiming.retry.maxMs);

  return ceiling / 2 + Math.random() * (ceiling / 2);
}

// Background imports for one server process: the requests that queue them, and the worker that runs them.
// Every job is queued through this object, so queueing wakes the worker directly and it never polls.
export function syncQueue(db: AppDatabase, runtime: WearableRuntime) {
  const later = (ms: number) => new Date(runtime.now().getTime() + ms);

  // The worker sleeps until the next job is due and wakes when a request queues one. With nothing queued it sets
  // no timer, so an idle server leaves the database alone. Until start(), waking does nothing, so tests run jobs by hand.
  let timer: NodeJS.Timeout | undefined;
  let reconciliation: NodeJS.Timeout | undefined;
  let running = false;
  let again = false;
  let stopped = true;

  const report = (step: string) => (failure: Error) => console.error(`Wearable ${step} failed: ${failure.message}`);

  function wake() {
    if (stopped) return;

    if (running) {
      again = true;

      return;
    }

    clearTimeout(timer);
    running = true;
    void tick().finally(() => {
      running = false;
    });
  }

  async function tick() {
    for (;;) {
      again = false;
      await runDueJobs().catch(report("import"));

      // A failed read cannot say when to wake, so the worker looks again a little later.
      const next = await nextDue().catch(() => later(syncTiming.rescanAfterErrorMs));

      if (stopped) return;

      // A job queued during either step may be missing from that read, so its wake runs the loop again instead.
      if (again) continue;

      // At least a second apart, so a job the clock disagrees about cannot spin the loop.
      if (next) timer = setTimeout(wake, Math.max(next.getTime() - runtime.now().getTime(), 1000));

      return;
    }
  }

  const reconcile = () => void queueReconciliation().catch(report("reconciliation"));

  // Queues an import for each live connection the condition picks, or merges into the one already waiting:
  // the kinds add up, the earliest date wins, and the sooner due time wins unless the job is waiting out a failure.
  async function request(connections: SQL | undefined, scope: SyncScope, dueAt: SQL): Promise<number> {
    const kinds = sql`ARRAY[${sql.join([...scope.kinds].sort().map((kind) => sql`${kind}`), sql`, `)}]::text[]`;

    const queued = await db.execute(sql`
      INSERT INTO wearable_sync_jobs (user_id, provider, kinds, since, due_at)
      SELECT user_id, provider, ${kinds}, ${scope.since}::date, ${dueAt}
      FROM wearable_connections WHERE ${and(isNotNull(wearableConnections.refreshToken), connections)}
      ON CONFLICT (user_id, provider) DO UPDATE SET
        kinds = ARRAY(SELECT DISTINCT unnest(wearable_sync_jobs.kinds || excluded.kinds) ORDER BY 1),
        since = CASE WHEN wearable_sync_jobs.since IS NULL OR excluded.since IS NULL THEN NULL ELSE least(wearable_sync_jobs.since, excluded.since) END,
        requests = wearable_sync_jobs.requests + 1,
        due_at = CASE WHEN wearable_sync_jobs.attempts > 0 THEN wearable_sync_jobs.due_at ELSE least(wearable_sync_jobs.due_at, excluded.due_at) END
      RETURNING user_id`);

    if (queued.length > 0) wake();

    return queued.length;
  }

  // A thrown error is not the provider's refusal, which sync reports, but something like a lost database
  // connection. It is retried like an outage. A provider this server no longer has settings for has nothing to sync.
  function syncJob(job: Job): Promise<SyncOutcome> {
    const provider = runtime.providers.find((candidate) => candidate.id === job.provider);

    if (!provider) return Promise.resolve({ outcome: "not-connected" });

    return connectionFor(db, runtime, provider, job.userId).sync({ kinds: job.kinds, since: job.since }).catch((failure: Error): SyncOutcome => {
      console.error(`Background ${job.provider} import failed: ${failure.message}`);

      return { outcome: "failed", reason: "unavailable", message: failure.message };
    });
  }

  async function run(job: Job): Promise<void> {
    const key = jobKey(job.userId, job.provider);
    const outcome = await syncJob(job);

    switch (outcome.outcome) {
      case "synced": {
        // A request that arrived during the run moved the count and may name data the run did not see, so its job
        // stays, due at once, with a clean record.
        const [done] = await db.delete(wearableSyncJobs).where(and(key, eq(wearableSyncJobs.requests, job.requests))).returning({ userId: wearableSyncJobs.userId });

        if (!done) await db.update(wearableSyncJobs).set({ attempts: 0 }).where(key);

        return;
      }

      // Another sync of this connection is reading now. Waiting for it is not a failure, so the attempts stay.
      case "busy":
        await db.update(wearableSyncJobs).set({ dueAt: later(outcome.retryAfterMs) }).where(key);

        return;

      // The connection is gone. Nothing to retry.
      case "not-connected":
        await db.delete(wearableSyncJobs).where(key);

        return;

      case "failed": {
        const attempts = job.attempts + 1;

        // Only a new sign-in helps a lost grant. After the last attempt the job is dropped too; lastError tells the
        // person, and the next app open or reconciliation tries again.
        if (outcome.reason === "reauthorize" || attempts >= syncTiming.retry.attempts) await db.delete(wearableSyncJobs).where(key);
        else await db.update(wearableSyncJobs).set({ attempts, dueAt: later(retryDelay(attempts)) }).where(key);
      }
    }
  }

  // Runs every job that is due, one at a time. Returns how many ran. One worker runs per server, and the
  // connection's sync lease keeps a second one from reading the same connection, so jobs need no lock of their own.
  async function runDueJobs(): Promise<number> {
    let ran = 0;

    for (;;) {
      const jobs = await db.select().from(wearableSyncJobs).where(lte(wearableSyncJobs.dueAt, runtime.now())).orderBy(asc(wearableSyncJobs.dueAt)).limit(syncTiming.batch);

      if (jobs.length === 0) return ran;

      for (const job of jobs) await run(job);
      ran += jobs.length;
    }
  }

  async function nextDue(): Promise<Date | null> {
    const [row] = await db.select({ next: min(wearableSyncJobs.dueAt) }).from(wearableSyncJobs);

    return row?.next ?? null;
  }

  // Queues a full re-read for people who opened Nouri lately and were not reconciled in the last day, spread over ten minutes.
  async function queueReconciliation(): Promise<number> {
    const now = runtime.now();
    const activeSince = new Date(now.getTime() - syncTiming.activeWithinMs);
    const reconciledBefore = new Date(now.getTime() - syncTiming.reconcileEveryMs);

    const due = and(
      gte(wearableConnections.openedAt, activeSince),
      or(isNull(wearableConnections.reconciledAt), lte(wearableConnections.reconciledAt, reconciledBefore)),
    );

    // Every configured provider, and none this server has no settings for.
    const queued = await Promise.all(runtime.providers.map((provider) =>
      request(and(eq(wearableConnections.provider, provider.id), due), everything, sql`${timestamp(now)} + random() * interval '10 minutes'`)));

    return queued.reduce((sum, count) => sum + count, 0);
  }

  return {
    runDueJobs,
    queueReconciliation,

    // Starts the background importer in this process: due jobs now and as they come due, and a reconciliation
    // scan every few hours. Returns wake for tests that move the clock.
    start: () => {
      stopped = false;
      reconciliation = setInterval(reconcile, syncTiming.reconcileScanMs);
      reconcile();
      wake();

      return {
        wake,
        stop: () => {
          stopped = true;
          clearTimeout(timer);
          clearInterval(reconciliation);
        },
      };
    },

    // Called when the person opens Nouri. The page already shows what is stored; this queues an import only when
    // that is stale and none is waiting, so repeated calls cost a read and a write.
    async refreshIfStale(provider: CloudProvider, userId: string): Promise<SyncState> {
      const now = runtime.now();
      const live = and(connectionKey(userId, provider.id), isNotNull(wearableConnections.refreshToken));

      const [[row], [waiting]] = await Promise.all([
        db.update(wearableConnections).set({ openedAt: now }).where(live).returning({ lastSyncedAt: wearableConnections.lastSyncedAt, reconciledAt: wearableConnections.reconciledAt }),
        db.select({ attempts: wearableSyncJobs.attempts }).from(wearableSyncJobs).where(jobKey(userId, provider.id)),
      ]);

      const scope = row && !waiting ? refreshScope(row, now, provider.webhook !== null) : null;

      if (scope) await request(connectionKey(userId, provider.id), scope, timestamp(now));

      return syncState(db, provider.id, userId);
    },

    // Queues one import per person the notifications name: the kinds that changed, from the earliest date any names.
    // A person connected to several Nouri accounts imports into each. Unknown people are ignored.
    async queueChanges(provider: CloudProvider, notices: ChangeNotice[]): Promise<number> {
      const byAccount = new Map<string, SyncScope>();

      for (const { accountId, kind, since } of notices) {
        const scope = byAccount.get(accountId);

        byAccount.set(accountId, scope ? { kinds: [...new Set([...scope.kinds, kind])], since: earliest(scope.since, since) } : { kinds: [kind], since });
      }

      const due = timestamp(later(syncTiming.debounceMs));

      const queued = await Promise.all([...byAccount].map(([accountId, scope]) =>
        request(and(eq(wearableConnections.provider, provider.id), eq(wearableConnections.providerUserId, accountId)), scope, due)));

      return queued.reduce((sum, count) => sum + count, 0);
    },
  };
}
