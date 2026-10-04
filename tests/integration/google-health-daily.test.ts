import assert from "node:assert/strict";
import { test } from "node:test";
import { googleHealthProvider } from "../../src/google-health/google.js";
import type { Overview } from "../../src/overview/contract.js";
import { FakeGoogle, googleConfig, googleScopes } from "../fake-google.js";
import { createHarness } from "../harness.js";

const google = new FakeGoogle();

let now = new Date("2026-09-27T12:00:00Z");

const { app, client, token, setup, cleanup } = createHarness({ tokenKey: Buffer.alloc(32, 7), now: () => now, providers: [googleHealthProvider({ ...googleConfig, fetch: google.fetch })] });

const auth = { Authorization: `Bearer ${token}` };

const base = "/v1/integrations/google-health";

const unchanged = { created: 0, updated: 0, removed: 0, skipped: 0 };

async function connect() {
  const started = await app.request(`${base}/authorizations`, { method: "POST", headers: auth });
  const cookie = /nouri_google-health_state=([^;]+)/.exec(started.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
  const { state, code } = google.approve((await started.json()).authorizationUrl);
  const callback = await app.request(`/oauth/google-health/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(code)}`, { headers: { Cookie: `nouri_google-health_state=${cookie}` } });

  return new URL(callback.headers.get("Location") ?? "", "http://x").searchParams.get("result");
}

async function sync() {
  const response = await app.request(`${base}/syncs`, { method: "POST", headers: auth });

  return { status: response.status, body: await response.json() };
}

async function overview(date: string): Promise<Pick<Overview, "activity" | "heartRate">> {
  const { activity, heartRate } = await (await app.request(`/v1/overview/${date}`, { headers: auth })).json();

  return { activity, heartRate };
}

async function rowCounts() {
  const [rows] = await client`SELECT (SELECT count(*)::int FROM daily_activity) AS activity, (SELECT count(*)::int FROM daily_heart_rate) AS "heartRate"`;

  return { ...rows };
}

void test("Google Health steps, active energy, and heart rate", async (t) => {
  await setup();

  try {
    await t.test("first import", async () => {
      google.days.set("2026-09-24", { steps: 9037, activeKcal: 412.6, heartRate: { average: 72, min: 48, max: 161 }, restingBpm: 58 });
      google.days.set("2026-09-25", { steps: 4000 });
      google.days.set("2026-09-26", { restingBpm: 60 });
      // A step count no wearable reaches is skipped instead of stored.
      google.days.set("2026-09-20", { steps: 500_000 });
      // Older than the 30-day window, so no sync reads it.
      google.days.set("2026-08-01", { steps: 1200 });

      assert.equal(await connect(), "connected");
      const first = await sync();
      assert.equal(first.status, 200);
      assert.deepEqual([first.body.activity, first.body.heartRate], [{ ...unchanged, created: 2, skipped: 1 }, { ...unchanged, created: 2 }]);
      assert.deepEqual((await (await app.request(base, { headers: auth })).json()).imported, { sleep: 0, workouts: 0, activity: 2, heartRate: 2 });

      assert.deepEqual(await overview("2026-09-24"), {
        activity: { steps: 9037, activeKcal: 413, provider: "google-health" },
        heartRate: { restingBpm: 58, range: { averageBpm: 72, minBpm: 48, maxBpm: 161 }, provider: "google-health" },
      });
      // A day with only a resting rate has no range, and a day without activity reads null, never zero.
      assert.deepEqual(await overview("2026-09-26"), { activity: null, heartRate: { restingBpm: 60, range: null, provider: "google-health" } });
      assert.deepEqual(await overview("2026-08-01"), { activity: null, heartRate: null });
    });

    await t.test("rollup ranges", async () => {
      // The window runs from 30 days back to two days past today's UTC date, so today is in every time zone.
      // Heart rate is read in Google's 14-day pieces; steps and active energy in one request each.
      const ranges = (dataType: string) => google.rollups.filter((rollup) => rollup.dataType === dataType).map(({ from, until }) => [from, until]);
      assert.deepEqual(ranges("heart-rate"), [["2026-08-28", "2026-09-11"], ["2026-09-11", "2026-09-25"], ["2026-09-25", "2026-09-29"]]);
      assert.deepEqual(ranges("steps"), [["2026-08-28", "2026-09-29"]]);
      assert.deepEqual(ranges("active-energy-burned"), [["2026-08-28", "2026-09-29"]]);
    });

    await t.test("repeat, correction, deletion, and return", async () => {
      const again = await sync();
      assert.deepEqual([again.body.activity, again.body.heartRate], [{ ...unchanged, skipped: 1 }, unchanged]);

      google.days.set("2026-09-24", { steps: 10_250, activeKcal: 412.6, heartRate: { average: 72, min: 48, max: 161 }, restingBpm: 57 });
      const corrected = await sync();
      assert.deepEqual([corrected.body.activity, corrected.body.heartRate], [{ ...unchanged, updated: 1, skipped: 1 }, { ...unchanged, updated: 1 }]);
      assert.deepEqual([(await overview("2026-09-24")).activity?.steps, (await overview("2026-09-24")).heartRate?.restingBpm], [10_250, 57]);

      // A day Google no longer has leaves Nouri, and comes back when Google does.
      const removed = google.days.get("2026-09-25");
      google.days.delete("2026-09-25");
      assert.deepEqual((await sync()).body.activity, { ...unchanged, removed: 1, skipped: 1 });
      assert.equal((await overview("2026-09-25")).activity, null);
      google.days.set("2026-09-25", removed ?? {});
      assert.deepEqual((await sync()).body.activity, { ...unchanged, created: 1, skipped: 1 });
      assert.deepEqual(await rowCounts(), { activity: 2, heartRate: 2 });
    });

    await t.test("an unreadable day fails the sync instead of removing it", async () => {
      google.unreadableSteps = true;
      const failed = await sync();
      assert.equal(failed.status, 502);
      assert.match(failed.body.error, /returned steps data Nouri could not read/);
      assert.deepEqual(await rowCounts(), { activity: 2, heartRate: 2 });
      assert.equal((await overview("2026-09-24")).activity?.steps, 10_250);
      google.unreadableSteps = false;

      google.unreadableResting = true;
      const restingFailed = await sync();
      assert.equal(restingFailed.status, 502);
      assert.match(restingFailed.body.error, /returned heart rate data Nouri could not read/);
      assert.equal((await overview("2026-09-24")).heartRate?.restingBpm, 57);
      google.unreadableResting = false;
    });

    await t.test("an incomplete read deletes nothing", async () => {
      // Steps that run past the page cap leave the days Google did not return in place, and say so.
      google.endlessSteps = true;
      const kept = google.days.get("2026-09-25");
      google.days.delete("2026-09-25");
      const partial = await sync();
      assert.equal(partial.status, 200);
      assert.equal(partial.body.activity.removed, 0);
      assert.match((await (await app.request(base, { headers: auth })).json()).lastError, /more steps and active energy than one sync reads/);
      assert.deepEqual(await rowCounts(), { activity: 2, heartRate: 2 });
      google.endlessSteps = false;
      google.days.set("2026-09-25", kept ?? {});
      assert.equal((await sync()).status, 200);
    });

    await t.test("days older than the window stay", async () => {
      // A month later the imported days fall outside what a sync reads, so absence there deletes nothing.
      now = new Date("2026-10-27T12:00:00Z");
      const later = await sync();
      assert.deepEqual([later.body.activity, later.body.heartRate], [unchanged, unchanged]);
      assert.deepEqual(await rowCounts(), { activity: 2, heartRate: 2 });
      now = new Date("2026-09-27T12:00:00Z");
    });

    await t.test("a grant without health metrics", async () => {
      // Heart rate needs its own scope. A grant without it keeps the imported heart rate and stops reading it.
      google.grantedScope = `${googleScopes.sleep} ${googleScopes.activity}`;
      assert.equal(await connect(), "connected");
      assert.deepEqual((await (await app.request(base, { headers: auth })).json()).granted, ["sleep", "workouts", "activity"]);
      const heartReads = google.rollups.filter((rollup) => rollup.dataType === "heart-rate").length;
      const partial = await sync();
      assert.deepEqual([partial.body.activity, partial.body.heartRate], [{ ...unchanged, skipped: 1 }, unchanged]);
      assert.equal(google.rollups.filter((rollup) => rollup.dataType === "heart-rate").length, heartReads);
      assert.equal((await overview("2026-09-24")).heartRate?.restingBpm, 57);
    });

    await t.test("disconnect", async () => {
      const disconnected = await (await app.request(base, { method: "DELETE", headers: auth })).json();
      assert.deepEqual(disconnected.removed, { sleep: 0, workouts: 0, activity: 2, heartRate: 2 });
      assert.deepEqual(await overview("2026-09-24"), { activity: null, heartRate: null });
      assert.deepEqual(await rowCounts(), { activity: 0, heartRate: 0 });
    });
  } finally {
    await cleanup();
  }
});
