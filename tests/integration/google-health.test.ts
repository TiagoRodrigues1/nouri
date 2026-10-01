import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { googleHealthProvider } from "../../src/google-health/google.js";
import type { SleepDay, SleepSession } from "../../src/sleep/contract.js";
import type { Workout, WorkoutDay } from "../../src/workouts/contract.js";
import { FakeGoogle, fixture, googleConfig } from "../fake-google.js";
import { createHarness } from "../harness.js";

const google = new FakeGoogle();

let now = new Date("2026-09-27T12:00:00Z");

const tokenKey = Buffer.alloc(32, 7);

const { app, client, token, setup, cleanup } = createHarness({ tokenKey, now: () => now, providers: [googleHealthProvider({ ...googleConfig, fetch: google.fetch })] });

const unconfigured = createHarness();

const auth = { Authorization: `Bearer ${token}` };

const base = "/v1/integrations/google-health";

const night = fixture("sleep-night");

const nap = fixture("sleep-nap");

const run = fixture("exercise-run");

const weights = fixture("exercise-weights");

const sleepScope = "https://www.googleapis.com/auth/googlehealth.sleep.readonly";

const exerciseScope = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

const unchanged = { created: 0, updated: 0, removed: 0, skipped: 0 };

function send(method: string, path: string, headers: Record<string, string> = {}) {
  return app.request(path, { method, headers: { ...auth, ...headers } });
}

async function status() {
  return (await app.request(base, { headers: auth })).json();
}

async function sync() {
  const response = await send("POST", `${base}/syncs`);

  return { status: response.status, body: await response.json() };
}

async function sleepOn(date: string): Promise<SleepDay> {
  return (await (await app.request(`/v1/overview/${date}`, { headers: auth })).json()).sleep;
}

async function sportsOn(date: string): Promise<WorkoutDay> {
  return (await (await app.request(`/v1/overview/${date}`, { headers: auth })).json()).sports;
}

// Starts sign-in in "the browser", lets the fake Google approve it, and follows the callback.
async function connect(options: { withCookie?: boolean; state?: string } = {}) {
  const started = await send("POST", `${base}/authorizations`);
  const cookie = /nouri_google-health_state=([^;]+)/.exec(started.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
  const { authorizationUrl } = await started.json();
  const approved = google.approve(authorizationUrl);
  const state = options.state ?? approved.state;

  const callback = await app.request(`/oauth/google-health/callback?state=${encodeURIComponent(state)}&code=${encodeURIComponent(approved.code)}`, {
    headers: options.withCookie === false ? {} : { Cookie: `nouri_google-health_state=${cookie}` },
  });

  return { started, authorizationUrl, cookie, state, code: approved.code, callback, result: new URL(callback.headers.get("Location") ?? "", "http://x").searchParams.get("result") };
}

void test("Google Health sleep and workouts", async (t) => {
  await setup();
  await unconfigured.setup();

  let connected: Awaited<ReturnType<typeof connect>>;
  let manual: SleepSession;
  let day: SleepDay;
  let imported: SleepSession;
  let importedRun: Workout;
  const importedDeleteKey = randomUUID();

  try {
    await t.test("configuration and authentication", async () => {
      // Without server settings the integration says so instead of failing later.
      const bare = await unconfigured.app.request(base, { headers: auth });
      assert.equal((await bare.json()).connection, "not-configured");
      assert.equal((await unconfigured.app.request(`${base}/authorizations`, { method: "POST", headers: auth })).status, 409);
      assert.equal((await app.request("/v1/integrations/fitbit-legacy", { headers: auth })).status, 404);
      assert.equal((await app.request(base)).status, 401);

      assert.equal((await status()).connection, "not-connected");
      assert.equal((await sync()).status, 409);
    });

    await t.test("OAuth state and consent", async () => {
      // Authorization asks to read sleep and exercise only, offline, with PKCE, and binds the state to an HttpOnly cookie.
      const forged = await connect({ withCookie: false });
      const url = new URL(forged.authorizationUrl);
      assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
      assert.equal(url.searchParams.get("scope"), `${sleepScope} ${exerciseScope}`);
      assert.equal(url.searchParams.get("access_type"), "offline");
      assert.equal(url.searchParams.get("code_challenge_method"), "S256");
      assert.equal(url.searchParams.get("redirect_uri"), googleConfig.redirectUri);
      assert.match(forged.started.headers.get("Set-Cookie") ?? "", /HttpOnly/i);
      assert.match(forged.started.headers.get("Set-Cookie") ?? "", /SameSite=Lax/i);
      assert.match(forged.started.headers.get("Set-Cookie") ?? "", /Path=\/oauth\/google-health\/callback/);

      // CSRF: a callback without this browser's cookie, or with another state, connects nothing.
      assert.equal(forged.callback.status, 303);
      assert.equal(forged.result, "expired-link");
      assert.equal((await connect({ state: "attacker-state" })).result, "expired-link");
      assert.equal((await status()).connection, "not-connected");
      assert.equal(google.requests.filter((request) => request.pathname === "/token").length, 0);

      // Starting on another address than the redirect URI would lose the cookie, so it is refused up front.
      const elsewhere = await send("POST", `${base}/authorizations`, { Origin: "http://localhost:3000" });
      assert.equal(elsewhere.status, 409);
      assert.match((await elsewhere.json()).error, /http:\/\/127\.0\.0\.1:3000/);
      assert.equal((await send("POST", `${base}/authorizations`, { Origin: "http://127.0.0.1:3000" })).status, 200);

      // Unticking every box on the consent screen leaves Nouri disconnected, and the empty grant is revoked.
      google.grantedScope = "";
      assert.equal((await connect()).result, "missing-scope");
      assert.equal(google.revoked.length, 1);
      google.grantedScope = `${sleepScope} ${exerciseScope}`;

      // Declining on Google's screen comes back with error=access_denied.
      const declined = await send("POST", `${base}/authorizations`);
      const declinedCookie = /nouri_google-health_state=([^;]+)/.exec(declined.headers.get("Set-Cookie") ?? "")?.[1] ?? "";
      const declinedState = new URL((await declined.json()).authorizationUrl).searchParams.get("state") ?? "";
      const denied = await app.request(`/oauth/google-health/callback?state=${declinedState}&error=access_denied`, { headers: { Cookie: `nouri_google-health_state=${declinedCookie}` } });
      assert.equal(denied.headers.get("Location"), "/overview?connect=google-health&result=denied");

      connected = await connect();
      assert.equal(connected.result, "connected");
      assert.equal(connected.callback.headers.get("Referrer-Policy"), "no-referrer");
      assert.match(connected.callback.headers.get("Set-Cookie") ?? "", /Max-Age=0/);

      // A state works once: replaying the callback does nothing.
      const replay = await app.request(`/oauth/google-health/callback?state=${connected.state}&code=${connected.code}`, { headers: { Cookie: `nouri_google-health_state=${connected.cookie}` } });
      assert.equal(new URL(replay.headers.get("Location") ?? "", "http://x").searchParams.get("result"), "expired-link");
    });

    await t.test("token storage and manual sleep", async () => {
      // Tokens stay on the server: encrypted at rest and absent from every response.
      const refresh = google.currentRefreshToken ?? "";
      const [stored] = await client`SELECT refresh_token, access_token FROM wearable_connections`;
      assert.ok(stored && !String(stored.refresh_token).includes(refresh) && !String(stored.access_token).includes("ya29."));
      const connectedStatus = await status();
      assert.equal(connectedStatus.connection, "connected");
      assert.equal(connectedStatus.lastSyncedAt, null);
      assert.deepEqual(connectedStatus.granted, ["sleep", "workouts"]);
      assert.ok(!JSON.stringify(connectedStatus).includes("fake-"));

      // A manual entry on the same day stays manual and deletable.
      manual = await (await app.request("/v1/sleep-sessions", { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify({ startedAt: "2026-09-24T20:00:00Z", endedAt: "2026-09-24T20:30:00Z", timeZone: "Europe/Lisbon", stages: null }) })).json();
      assert.deepEqual(manual.source, { kind: "manual" });
    });

    await t.test("first import", async () => {
      // First import.
      google.put(night);
      google.put(nap);
      google.put(fixture("sleep-too-long"));
      google.put(run);
      google.put(weights);
      google.put(fixture("exercise-too-short"));
      const first = await sync();
      assert.equal(first.status, 200);
      assert.deepEqual(first.body, { sleep: { created: 2, updated: 0, removed: 0, skipped: 1 }, workouts: { created: 2, updated: 0, removed: 0, skipped: 1 } });
      assert.equal((await status()).lastSyncedAt, now.toISOString());
      assert.deepEqual((await status()).imported, { sleep: 2, workouts: 2 });
      const filter = (type: string) => google.requests.find((request) => request.pathname.endsWith(`/${type}/dataPoints`))?.searchParams.get("filter");
      assert.equal(filter("sleep"), 'sleep.interval.end_time >= "2026-08-28T12:00:00.000Z"');
      assert.equal(filter("exercise"), 'exercise.interval.civil_start_time >= "2026-08-28"');

      day = await sleepOn("2026-09-24");
      const found = day.sessions.find((item) => item.source.kind === "wearable" && item.source.device === "Google Fitbit Air");
      assert.ok(found);
      imported = found;
      assert.deepEqual(imported.source, { kind: "wearable", provider: "google-health", device: "Google Fitbit Air" });
      assert.equal(imported.timeZone, "-04:00");
      assert.equal(imported.localDate, "2026-09-24");
      assert.equal(imported.startedAt, "2026-09-24T02:40:00.000Z");
      assert.deepEqual(imported.stages, { awake: 35, light: 230, deep: 90, rem: 110 });
      assert.equal(day.sessions.length, 3);
      assert.equal(day.totalMinutes, 465 + 45 + 30);
    });

    await t.test("first workout import", async () => {
      // Both workouts start on the evening of 2026-09-24 at -04:00; the weights begin after midnight UTC.
      const sports = await sportsOn("2026-09-24");
      assert.deepEqual(sports.entries.map((entry) => [entry.activity, entry.source]), [
        ["run", { kind: "wearable", provider: "google-health", device: "Google Fitbit Air", title: "Evening Run" }],
        ["strength", { kind: "wearable", provider: "google-health", device: "Fitbit Air", title: "Weights" }],
      ]);
      const [first] = sports.entries;
      assert.ok(first);
      importedRun = first;
      // Active time leaves out the five-minute pause.
      assert.deepEqual({ ...importedRun, id: undefined }, {
        id: undefined, revision: 1, occurredAt: "2026-09-24T21:30:00.000Z", timeZone: "-04:00", localDate: "2026-09-24",
        activity: "run", durationMinutes: 40, distanceM: 8020, energyKcal: 512, strengthExercises: null, source: importedRun.source,
      });
      assert.equal(sports.entries[1]?.distanceM, null);
      assert.deepEqual({ entryCount: sports.entryCount, totalMinutes: sports.totalMinutes, energyKcal: sports.energyKcal }, { entryCount: 2, totalMinutes: 90, energyKcal: 752 });
    });

    await t.test("deletion lock and repeat sync", async () => {
      // Imported sleep follows Google, so Nouri refuses to delete it; manual sleep still deletes.
      const inaccessible = await send("DELETE", `/v1/sleep-sessions/${imported.id}`, { "If-Match": `"${imported.revision}"`, "Idempotency-Key": importedDeleteKey });
      assert.equal(inaccessible.status, 404);
      assert.equal((await send("DELETE", `/v1/workouts/${importedRun.id}`, { "If-Match": `"${importedRun.revision}"`, "Idempotency-Key": randomUUID() })).status, 404);

      // Repeated import: nothing duplicates and no revision moves.
      const again = await sync();
      assert.deepEqual(again.body, { sleep: { ...unchanged, skipped: 1 }, workouts: { ...unchanged, skipped: 1 } });
      const [rows] = await client`SELECT (SELECT count(*)::int FROM sleep_sessions WHERE source = 'google-health') AS sleep, (SELECT count(*)::int FROM workouts WHERE source = 'google-health') AS workouts`;
      assert.deepEqual({ ...rows }, { sleep: 2, workouts: 2 });
      assert.equal((await sleepOn("2026-09-24")).sessions.find((item) => item.id === imported.id)?.revision, 1);
    });

    await t.test("source correction", async () => {
      // Correction: Google edits the night, and the same Nouri row takes the new revision.
      google.put(fixture("sleep-night-corrected"));
      google.put(fixture("exercise-run-corrected"));
      const corrected = await sync();
      assert.deepEqual(corrected.body, { sleep: { ...unchanged, updated: 1, skipped: 1 }, workouts: { ...unchanged, updated: 1, skipped: 1 } });
      const rerun = (await sportsOn("2026-09-24")).entries.find((entry) => entry.id === importedRun.id);
      assert.deepEqual([rerun?.revision, rerun?.durationMinutes, rerun?.distanceM], [2, 42, 8450]);
      day = await sleepOn("2026-09-24");
      const edited = day.sessions.find((item: { id: string }) => item.id === imported.id);
      assert.ok(edited);
      assert.equal(edited.revision, 2);
      assert.equal(edited.startedAt, "2026-09-24T02:10:00.000Z");
      assert.deepEqual(edited.stages, { awake: 40, light: 255, deep: 90, rem: 110 });
    });

    await t.test("source deletion and revival", async () => {
      // Deletion: the nap is gone from Google, so it leaves Nouri; the manual session stays.
      google.points.delete(nap.name);
      google.points.delete(weights.name);
      const deleted = await sync();
      assert.deepEqual(deleted.body, { sleep: { ...unchanged, removed: 1, skipped: 1 }, workouts: { ...unchanged, removed: 1, skipped: 1 } });
      assert.deepEqual((await sportsOn("2026-09-24")).entries.map((entry) => entry.id), [importedRun.id]);
      day = await sleepOn("2026-09-24");
      assert.deepEqual(day.sessions.map((item: { source: { kind: string } }) => item.source.kind).sort(), ["manual", "wearable"]);
      const [removedNap] = await client`SELECT deleted_at, revision FROM sleep_sessions WHERE source_id = ${nap.name}`;
      assert.ok(removedNap?.deleted_at);
      assert.equal(removedNap?.revision, 2);

      // A record Google restores revives the same row instead of duplicating it.
      google.put(nap);
      google.put(weights);
      const revival = (await sync()).body;
      assert.deepEqual([revival.sleep.created, revival.workouts.created], [1, 1]);
      const [revived] = await client`SELECT count(*)::int AS n, max(revision) AS revision FROM sleep_sessions WHERE source_id = ${nap.name} AND deleted_at IS NULL`;
      assert.deepEqual({ ...revived }, { n: 1, revision: 3 });
    });

    await t.test("token refresh", async () => {
      // An expired access token is refreshed without bothering the person.
      google.expireAccessTokens();
      assert.equal((await sync()).status, 200);
      now = new Date(now.getTime() + 2 * 3_600_000);
      assert.equal((await sync()).status, 200);
    });

    await t.test("provider outage", async () => {
      // A Google outage is reported, keeps the connection, and does not move the last successful sync.
      const lastGood = (await status()).lastSyncedAt;
      google.outage = true;
      const outage = await sync();
      assert.equal(outage.status, 502);
      assert.match(outage.body.error, /Google Health could not return sleep data \(503\)/);
      const afterOutage = await status();
      assert.equal(afterOutage.connection, "connected");
      assert.equal(afterOutage.lastSyncedAt, lastGood);
      assert.match(afterOutage.lastError, /503/);
      google.outage = false;
    });

    await t.test("revoked grant and reconnect", async () => {
      // Authorization failure: the grant is revoked, so Nouri asks for Connect again and keeps what it imported.
      google.revokeGrant();
      const failed = await sync();
      assert.equal(failed.status, 409);
      assert.match(failed.body.error, /Choose Connect to sign in again/);
      const stale = await status();
      assert.equal(stale.connection, "reauthorize");
      assert.deepEqual(stale.imported, { sleep: 2, workouts: 2 });
      assert.deepEqual(stale.granted, []);
      assert.match(stale.lastError, /expired or was revoked/);
      const [dropped] = await client`SELECT refresh_token, access_token FROM wearable_connections`;
      assert.deepEqual({ ...dropped }, { refresh_token: null, access_token: null });
      assert.equal((await sync()).status, 409);

      // Connecting again resumes syncing against the same imports.
      assert.equal((await connect()).result, "connected");
      const resumed = await sync();
      assert.equal(resumed.status, 200);
      assert.equal((await status()).lastError, null);
    });

    await t.test("sleep-only grant", async () => {
      // A grant from before workouts, or with the exercise box unticked, still syncs sleep and leaves workouts alone.
      google.grantedScope = sleepScope;
      assert.equal((await connect()).result, "connected");
      assert.deepEqual((await status()).granted, ["sleep"]);
      const exerciseReads = google.requests.filter((request) => request.pathname.endsWith("/exercise/dataPoints")).length;
      const sleepOnly = await sync();
      assert.equal(sleepOnly.status, 200);
      assert.deepEqual(sleepOnly.body.workouts, unchanged);
      assert.equal(google.requests.filter((request) => request.pathname.endsWith("/exercise/dataPoints")).length, exerciseReads);
      assert.equal((await sportsOn("2026-09-24")).entryCount, 2);

      // Connecting again with both boxes ticked resumes workouts.
      google.grantedScope = `${sleepScope} ${exerciseScope}`;
      assert.equal((await connect()).result, "connected");
      assert.deepEqual((await status()).granted, ["sleep", "workouts"]);
      assert.equal((await sync()).status, 200);
    });

    await t.test("disconnect", async () => {
      // Disconnect revokes Google's grant and removes imported sleep, leaving manual entries.
      const liveRefresh = google.currentRefreshToken;
      const disconnected = await send("DELETE", base);
      assert.equal(disconnected.status, 200);
      assert.deepEqual(await disconnected.json(), { revoked: true, removed: { sleep: 2, workouts: 2 } });
      assert.ok(google.revoked.includes(liveRefresh ?? ""));
      assert.equal((await status()).connection, "not-connected");
      day = await sleepOn("2026-09-24");
      assert.deepEqual(day.sessions.map((item: { id: string }) => item.id), [manual.id]);
      assert.equal((await sportsOn("2026-09-24")).entryCount, 0);
      const [left] = await client`SELECT count(*)::int AS n FROM wearable_connections`;
      assert.equal(left?.n, 0);
      assert.equal((await send("DELETE", `/v1/sleep-sessions/${imported.id}`, { "If-Match": `"${imported.revision}"`, "Idempotency-Key": importedDeleteKey })).status, 404);

      const spec = await (await app.request("/openapi.json")).json();

      for (const path of ["/v1/integrations/{provider}", "/v1/integrations/{provider}/authorizations", "/v1/integrations/{provider}/syncs"]) assert.ok(spec.paths[path], path);

      for (const operation of [spec.paths["/v1/integrations/{provider}/authorizations"].post, spec.paths["/v1/integrations/{provider}/syncs"].post, spec.paths["/v1/integrations/{provider}"].delete]) {
        assert.ok(!operation.parameters?.some((item: { name: string }) => item.name === "Idempotency-Key"));
      }
    });

  } finally {
    await cleanup();
    await unconfigured.cleanup();
  }
});
