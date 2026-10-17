import assert from "node:assert/strict";
import { test } from "node:test";
import { googleHealthProvider } from "../../src/google-health/google.js";
import type { WearableRuntime } from "../../src/wearables/provider.js";
import { setTimeout as sleep } from "node:timers/promises";
import { syncTiming } from "../../src/wearables/sync-timing.js";
import { FakeGoogle, fixture, googleConfig } from "../fake-google.js";
import { createHarness } from "../harness.js";

const webhookSecret = "test-webhook-secret-0123456789abcdef";

const base = "/v1/integrations/google-health";

const night = fixture("sleep-night");

const run = fixture("exercise-run");

// A notification as Google sends it, for one person, data type, and local start time.
function notification(dataType: string, civilStart: string, healthUserId = "fake-health-user-1") {
  return { data: { version: "1", clientProvidedSubscriptionName: `auto-1-nouri-${dataType}`, healthUserId, operation: "UPSERT", dataType, intervals: [{ civilIso8601TimeInterval: { startTime: civilStart, endTime: civilStart } }] } };
}

// What Google posts: one notification, a batch, or its endpoint check. A string stands for a body Nouri cannot read.
type WebhookBody = ReturnType<typeof notification> | ReturnType<typeof notification>[] | { type: "verification" } | string;

// One Google account and a Nouri server, with or without webhooks.
function server(withWebhooks: boolean) {
  const google = new FakeGoogle();
  const clock = { now: new Date("2026-09-27T12:00:00Z") };
  // Each Google request runs this first, so a test can act while a sync is in flight.
  const hooks: (() => Promise<void>)[] = [];

  const fetch: typeof globalThis.fetch = async (input, init) => {
    await hooks.shift()?.();

    return google.fetch(input, init);
  };

  const runtime: WearableRuntime = {
    tokenKey: Buffer.alloc(32, 7),
    now: () => clock.now,
    providers: [googleHealthProvider({ ...googleConfig, webhookSecret: withWebhooks ? webhookSecret : undefined, fetch })],
  };

  const harness = createHarness(runtime);
  const queue = harness.wearables?.queue;

  if (!queue) throw new Error("The harness builds a queue for a runtime");
  const auth = { Authorization: `Bearer ${harness.token}` };

  return {
    ...harness, google, clock, hooks, runtime, queue, auth,
    advance: (ms: number) => {
      clock.now = new Date(clock.now.getTime() + ms);
    },
    runJobs: () => queue.runDueJobs(),
    connect: async () => {
      const started = await harness.app.request(`${base}/authorizations`, { method: "POST", headers: auth });
      const cookie = /nouri_google-health_state=([^;]+)/.exec(started.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
      const { state, code } = google.approve((await started.json()).authorizationUrl);
      const callback = await harness.app.request(`/oauth/google-health/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`, { headers: { Cookie: `nouri_google-health_state=${cookie}` } });

      return new URL(callback.headers.get("Location") ?? "", "http://x").searchParams.get("result");
    },
    // Sync now as the person presses it, at the clock's current time.
    syncNow: () => harness.app.request(`${base}/syncs`, { method: "POST", headers: auth }),
    // Sync now after its cooldown has passed.
    sync: async () => {
      clock.now = new Date(clock.now.getTime() + syncTiming.manualCooldownMs);

      return (await harness.app.request(`${base}/syncs`, { method: "POST", headers: auth })).status;
    },
    refresh: async () => (await harness.app.request(`${base}/refreshes`, { method: "POST", headers: auth })).json(),
    notify: (body: WebhookBody, authorization: string | null = `Bearer ${webhookSecret}`) => {
      const headers = new Headers({ "Content-Type": "application/json", "User-Agent": "Google-Health-API-Webhooks" });

      if (authorization) headers.set("Authorization", authorization);

      return harness.app.request("/webhooks/google-health", { method: "POST", headers, body: JSON.stringify(body) });
    },
    // Drizzle shares the client and reads timestamps as strings, so they are parsed here.
    job: async () => {
      const [row] = await harness.client`SELECT kinds, to_char(since, 'YYYY-MM-DD') AS since, attempts, due_at FROM wearable_sync_jobs`;

      return row ? { kinds: row.kinds, since: row.since, attempts: row.attempts, dueAt: new Date(row.due_at) } : null;
    },
    connection: async () => {
      const [row] = await harness.client`SELECT provider_user_id, last_synced_at, reconciled_at FROM wearable_connections`;

      return { providerUserId: row?.provider_user_id, lastSyncedAt: row?.last_synced_at && new Date(row.last_synced_at), reconciledAt: row?.reconciled_at && new Date(row.reconciled_at) };
    },
    // Writes timestamps as text, for the same reason.
    setConnection: (column: "reconciled_at" | "opened_at", value: Date | null) => harness.client`UPDATE wearable_connections SET ${harness.client(column)} = ${value?.toISOString() ?? null}`,
    // Google requests since the mark, as "path filter-or-range".
    readsSince: (mark: number) => google.requests.slice(mark).map((url) => url.pathname.split("/").at(-1) === "identity" ? "identity" : `${url.pathname.split("/").at(-2)}${url.pathname.endsWith(":dailyRollUp") ? ":dailyRollUp" : ""}`),
  };
}

void test("Google Health imports in the background", async (t) => {
  const nouri = server(true);
  const { client, google, clock } = nouri;

  await nouri.setup();

  try {
    await t.test("connecting records the Google account notifications name", async () => {
      assert.equal(await nouri.connect(), "connected");
      assert.equal((await nouri.connection()).providerUserId, "fake-health-user-1");
      // The first sync after connecting re-reads everything, so it counts as reconciliation.
      assert.equal(await nouri.sync(), 200);
      const synced = await nouri.connection();
      assert.deepEqual([synced.reconciledAt, synced.lastSyncedAt], [clock.now, clock.now]);
    });

    await t.test("webhook endpoint verification", async () => {
      // Google checks both answers before it sends anything: 200 with the secret and 401 without.
      assert.equal((await nouri.notify({ type: "verification" })).status, 200);
      assert.equal((await nouri.notify({ type: "verification" }, null)).status, 401);
      assert.equal((await nouri.notify({ type: "verification" }, "Bearer wrong-secret-0123456789abcdef0123")).status, 401);
      assert.equal((await nouri.notify([notification("sleep", "2026-09-24T00:00:00")], null)).status, 401);
      assert.equal(await nouri.job(), null);
      assert.equal((await nouri.app.request("/webhooks/fitbit-legacy", { method: "POST", body: "{}" })).status, 404);
    });

    await t.test("a burst of notifications runs one narrow import", async () => {
      google.put(night);
      google.put(run);
      google.days.set("2026-09-25", { steps: 4000, activeKcal: 180 });

      // Two deliveries, a batch and a single object, plus a person Nouri does not know and a data type it does not import.
      assert.equal((await nouri.notify([notification("sleep", "2026-09-24T02:40:00"), notification("steps", "2026-09-25T00:00:00"), notification("weight", "2026-09-01T00:00:00")])).status, 204);
      assert.equal((await nouri.notify(notification("sleep", "2026-09-23T22:00:00"))).status, 204);
      assert.equal((await nouri.notify(notification("sleep", "2026-09-01T00:00:00", "someone-else"))).status, 204);
      assert.equal((await nouri.notify("not a notification")).status, 204);

      const job = await nouri.job();
      assert.deepEqual(job && { kinds: job.kinds, since: job.since, attempts: job.attempts }, { kinds: ["activity", "sleep"], since: "2026-09-22", attempts: 0 });
      assert.equal(job?.dueAt.getTime(), clock.now.getTime() + syncTiming.debounceMs);
      assert.equal((await nouri.refresh()).pending, true);

      // Nothing runs until the burst has settled.
      assert.equal(await nouri.runJobs(), 0);
      nouri.advance(syncTiming.debounceMs);
      const mark = google.requests.length;
      assert.equal(await nouri.runJobs(), 1);
      assert.equal(await nouri.job(), null);

      // Only sleep and activity were read, from the earliest changed day; workouts and heart rate were not.
      const reads = nouri.readsSince(mark);
      assert.deepEqual([...new Set(reads)].sort(), ["active-energy-burned:dailyRollUp", "sleep", "steps:dailyRollUp"]);
      assert.equal(google.requests.slice(mark).find((url) => url.pathname.endsWith("/sleep/dataPoints"))?.searchParams.get("filter"), 'sleep.interval.end_time >= "2026-09-22T00:00:00.000Z"');
      assert.deepEqual(google.rollups.slice(-2).map((rollup) => rollup.from), ["2026-09-22", "2026-09-22"]);

      const [counts] = await client`SELECT (SELECT count(*)::int FROM sleep_sessions WHERE deleted_at IS NULL) AS sleep, (SELECT count(*)::int FROM workouts) AS workouts, (SELECT count(*)::int FROM daily_activity) AS activity`;
      assert.deepEqual({ ...counts }, { sleep: 1, workouts: 0, activity: 1 });

      const state = await nouri.refresh();
      assert.deepEqual(state, { pending: false, lastSyncedAt: clock.now.toISOString(), lastError: null });
      // A narrow import is not a reconciliation.
      assert.ok(((await nouri.connection()).reconciledAt?.getTime() ?? Infinity) < clock.now.getTime());
    });

    await t.test("a notification during an import runs it again", async () => {
      nouri.hooks.push(async () => {
        assert.equal((await nouri.notify(notification("exercise", "2026-09-24T17:30:00"))).status, 204);
      });
      assert.equal((await nouri.notify(notification("sleep", "2026-09-24T02:40:00"))).status, 204);
      nouri.advance(syncTiming.debounceMs);
      // The exercise notice arrived during the first run, so the job stays and runs again to import the run.
      assert.equal(await nouri.runJobs(), 2);
      assert.equal(await nouri.job(), null);
      const [row] = await client`SELECT count(*)::int AS n FROM workouts WHERE source = 'google-health'`;
      assert.equal(row?.n, 1);
    });

    await t.test("opening Nouri imports only when stored data is stale", async () => {
      // Notifications keep imports current, so a recent sync is trusted.
      nouri.advance(60 * 60_000);
      assert.equal((await nouri.refresh()).pending, false);
      assert.equal(await nouri.job(), null);

      // Past the threshold, opening Nouri queues all kinds from a few days before the last sync, due at once.
      const lastSync = clock.now;
      nouri.advance(syncTiming.staleAfterMs.notified);
      const state = await nouri.refresh();
      assert.deepEqual(state, { pending: true, lastSyncedAt: new Date(lastSync.getTime() - 60 * 60_000).toISOString(), lastError: null });
      const job = await nouri.job();
      assert.deepEqual(job && { kinds: job.kinds, since: job.since }, { kinds: ["activity", "heartRate", "sleep", "workouts"], since: "2026-09-24" });

      // Opening it again while the job waits adds nothing.
      assert.equal((await nouri.refresh()).pending, true);
      assert.equal(await nouri.runJobs(), 1);
      assert.deepEqual(await nouri.refresh(), { pending: false, lastSyncedAt: clock.now.toISOString(), lastError: null });

      // A day after the last reconciliation, a stale open re-reads the whole window instead.
      nouri.advance(syncTiming.reconcileEveryMs);
      await nouri.refresh();
      assert.equal((await nouri.job())?.since, null);
      assert.equal(await nouri.runJobs(), 1);
      assert.deepEqual((await nouri.connection()).reconciledAt, clock.now);
    });

    await t.test("an outage retries with growing delays", async () => {
      google.outage = true;
      await nouri.notify(notification("sleep", "2026-09-26T23:00:00"));
      nouri.advance(syncTiming.debounceMs);
      assert.equal(await nouri.runJobs(), 1);

      const failed = await nouri.job();
      assert.equal(failed?.attempts, 1);
      const wait = (failed?.dueAt.getTime() ?? 0) - clock.now.getTime();
      assert.ok(wait >= syncTiming.retry.firstMs / 2 && wait <= syncTiming.retry.firstMs, `${wait}`);
      // The person sees why, and the page stops waiting on it.
      const state = await nouri.refresh();
      assert.equal(state.pending, false);
      assert.match(state.lastError, /503/);

      // A new notification does not cut the wait short, and nothing runs before it ends.
      await nouri.notify(notification("steps", "2026-09-26T00:00:00"));
      assert.deepEqual((await nouri.job())?.dueAt, failed?.dueAt);
      assert.equal(await nouri.runJobs(), 0);

      // The next failure waits about twice as long.
      nouri.advance(wait);
      assert.equal(await nouri.runJobs(), 1);
      const second = await nouri.job();
      const secondWait = (second?.dueAt.getTime() ?? 0) - clock.now.getTime();
      assert.equal(second?.attempts, 2);
      assert.ok(secondWait >= syncTiming.retry.firstMs && secondWait <= 2 * syncTiming.retry.firstMs, `${secondWait}`);

      // Once Google answers again, the job finishes with every kind the notifications named.
      google.outage = false;
      nouri.advance(secondWait);
      assert.equal(await nouri.runJobs(), 1);
      assert.equal(await nouri.job(), null);
      assert.equal((await nouri.refresh()).lastError, null);
    });

    await t.test("a job that keeps failing is dropped", async () => {
      google.outage = true;
      await nouri.notify(notification("sleep", "2026-09-26T23:00:00"));

      for (let attempt = 0; attempt < syncTiming.retry.attempts; attempt += 1) {
        nouri.advance(syncTiming.retry.maxMs);
        assert.equal(await nouri.runJobs(), 1);
      }

      assert.equal(await nouri.job(), null);
      google.outage = false;
    });

    await t.test("Sync now waits a minute between syncs", async () => {
      assert.equal(await nouri.sync(), 200);
      const reads = google.requests.length;

      // Pressing it again right away reads nothing from Google.
      nouri.advance(10_000);
      const again = await nouri.syncNow();
      assert.equal(again.status, 429);
      assert.equal(again.headers.get("Retry-After"), "50");
      assert.match((await again.json()).error, /Try again in 50 seconds/);
      assert.equal(google.requests.length, reads);

      nouri.advance(50_000);
      assert.equal((await nouri.syncNow()).status, 200);
    });

    await t.test("one sync at a time per connection", async () => {
      await nouri.notify(notification("sleep", "2026-09-26T23:00:00"));
      nouri.advance(syncTiming.manualCooldownMs);

      // While Sync now is reading from Google, neither a second press nor the background job reads too.
      nouri.hooks.push(async () => {
        const second = await nouri.syncNow();
        assert.equal(second.status, 429);
        assert.match((await second.json()).error, /already running/);

        nouri.advance(syncTiming.debounceMs);
        assert.equal(await nouri.runJobs(), 1);
        const waiting = await nouri.job();
        // Waiting for the other sync is not a failure.
        assert.equal(waiting?.attempts, 0);
        assert.equal(waiting?.dueAt.getTime(), clock.now.getTime() + syncTiming.busyRetryMs);
      });

      const reads = google.requests.length;
      assert.equal((await nouri.syncNow()).status, 200);
      // One full read: sleep, exercise, and the three rollups and resting heart rate, with no second copy.
      assert.equal(google.requests.slice(reads).filter((url) => url.pathname.endsWith("/sleep/dataPoints")).length, 1);
      const [lease] = await client`SELECT sync_started_at FROM wearable_connections`;
      assert.equal(lease?.sync_started_at, null);

      // The job runs once the lease is free.
      nouri.advance(syncTiming.busyRetryMs);
      assert.equal(await nouri.runJobs(), 1);
      assert.equal(await nouri.job(), null);
    });

    await t.test("a stopped sync's lease lapses", async () => {
      await client`UPDATE wearable_connections SET sync_started_at = ${clock.now.toISOString()}`;
      nouri.advance(syncTiming.manualCooldownMs);
      assert.equal((await nouri.syncNow()).status, 429);
      nouri.advance(syncTiming.leaseMs);
      assert.equal((await nouri.syncNow()).status, 200);
    });

    await t.test("a sync that outlived its lease saves nothing", async () => {
      google.put(fixture("sleep-night-corrected"));
      const [before] = await client`SELECT revision FROM sleep_sessions WHERE source_id = ${night.name}`;

      // While this sync reads, its lease lapses and a newer sync takes it.
      nouri.hooks.push(async () => {
        nouri.advance(syncTiming.leaseMs);
        await client`UPDATE wearable_connections SET sync_started_at = ${clock.now.toISOString()}`;
      });

      nouri.advance(syncTiming.manualCooldownMs);
      const stale = await nouri.syncNow();
      assert.equal(stale.status, 429);
      assert.match((await stale.json()).error, /already running/);

      // The correction it read was not applied, and the newer sync's lease is untouched.
      const [after] = await client`SELECT revision FROM sleep_sessions WHERE source_id = ${night.name}`;
      assert.equal(after?.revision, before?.revision);
      const [lease] = await client`SELECT sync_started_at FROM wearable_connections`;
      assert.notEqual(lease?.sync_started_at, null);
      await client`UPDATE wearable_connections SET sync_started_at = NULL`;
      google.put(night);
    });

    await t.test("daily reconciliation covers people who use Nouri", async () => {
      await nouri.setConnection("reconciled_at", new Date(clock.now.getTime() - syncTiming.reconcileEveryMs));
      await nouri.setConnection("opened_at", null);
      assert.equal(await nouri.queue.queueReconciliation(), 0);

      await nouri.setConnection("opened_at", new Date(clock.now.getTime() - syncTiming.activeWithinMs + 60_000));
      assert.equal(await nouri.queue.queueReconciliation(), 1);
      const job = await nouri.job();
      assert.deepEqual(job && { kinds: job.kinds, since: job.since }, { kinds: ["activity", "heartRate", "sleep", "workouts"], since: null });
      // Spread over ten minutes, so many people do not hit Google at once.
      const delay = (job?.dueAt.getTime() ?? 0) - clock.now.getTime();
      assert.ok(delay >= 0 && delay <= 10 * 60_000, `${delay}`);

      // A recent reconciliation is not repeated.
      nouri.advance(10 * 60_000);
      assert.equal(await nouri.runJobs(), 1);
      assert.equal(await nouri.queue.queueReconciliation(), 0);
    });

    await t.test("a revoked grant drops the job", async () => {
      await nouri.notify(notification("sleep", "2026-09-26T23:00:00"));
      google.revokeGrant();
      nouri.advance(syncTiming.debounceMs);
      assert.equal(await nouri.runJobs(), 1);
      assert.equal(await nouri.job(), null);
      // Without a grant there is nothing to refresh or queue.
      nouri.advance(syncTiming.reconcileEveryMs);
      assert.equal((await nouri.refresh()).pending, false);
      assert.equal((await nouri.notify(notification("sleep", "2026-09-26T23:00:00"))).status, 204);
      assert.equal(await nouri.job(), null);
    });

    await t.test("disconnecting removes a waiting job", async () => {
      assert.equal(await nouri.connect(), "connected");
      await nouri.notify(notification("sleep", "2026-09-26T23:00:00"));
      assert.notEqual(await nouri.job(), null);
      assert.equal((await nouri.app.request(base, { method: "DELETE", headers: nouri.auth })).status, 200);
      assert.equal(await nouri.job(), null);
    });
  } finally {
    await nouri.cleanup();
  }
});

void test("Google Health without webhooks refreshes when Nouri opens", async () => {
  const nouri = server(false);

  await nouri.setup();

  try {
    // Nothing receives notifications on localhost.
    assert.equal((await nouri.notify({ type: "verification" })).status, 404);

    // Not connected: nothing to do, and the page still gets an answer.
    assert.deepEqual(await nouri.refresh(), { pending: false, lastSyncedAt: null, lastError: null });

    assert.equal(await nouri.connect(), "connected");
    nouri.google.put(night);

    // Never synced, so the first open imports everything.
    assert.equal((await nouri.refresh()).pending, true);
    assert.equal((await nouri.job())?.since, null);
    assert.equal(await nouri.runJobs(), 1);
    const synced = nouri.clock.now.toISOString();
    assert.deepEqual(await nouri.refresh(), { pending: false, lastSyncedAt: synced, lastError: null });

    // Without notifications, imports are trusted for 15 minutes.
    nouri.advance(syncTiming.staleAfterMs.unnotified - 1);
    assert.equal((await nouri.refresh()).pending, false);
    nouri.advance(1);
    assert.equal((await nouri.refresh()).pending, true);
    assert.equal((await nouri.job())?.since, "2026-09-24");
    assert.equal(await nouri.runJobs(), 1);
  } finally {
    await nouri.cleanup();
  }
});

void test("an idle worker leaves the database alone", async () => {
  const nouri = server(true);
  const timeouts = () => process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;

  // Waits for the worker's asynchronous step to settle on the expected number of timers.
  async function settlesAt(expected: number) {
    for (let tries = 0; tries < 100 && timeouts() !== expected; tries += 1) await sleep(20);

    return timeouts();
  }

  await nouri.setup();
  // postgres.js keeps a lifetime timer per pooled connection, so the pool is opened in full before counting.
  await Promise.all(Array.from({ length: 10 }, () => nouri.client`SELECT pg_sleep(0.05)`));
  const before = timeouts();
  const worker = nouri.queue.start();

  try {
    // Nothing queued: only the reconciliation scan's interval, no timer that would poll the database.
    assert.equal(await settlesAt(before + 1), before + 1);

    // A queued notification sets one timer for when its job is due.
    assert.equal(await nouri.connect(), "connected");
    await nouri.notify(notification("sleep", "2026-09-24T02:40:00"));
    assert.equal(await settlesAt(before + 2), before + 2);

    // Once it has run, the worker goes back to sleeping without a timer.
    nouri.advance(syncTiming.debounceMs);
    worker.wake();

    for (let tries = 0; tries < 100 && await nouri.job() !== null; tries += 1) await sleep(20);
    assert.equal(await nouri.job(), null);
    assert.equal(await settlesAt(before + 1), before + 1);
  } finally {
    worker.stop();
    await nouri.cleanup();
  }
});
