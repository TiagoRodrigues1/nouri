import { createHarness } from "../test/harness.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const { app, otherApp, client, token, setup, cleanup } = createHarness();

const auth = { Authorization: `Bearer ${token}` };

const zone = "Europe/Lisbon";

// The smallest valid PNG header is enough; the server checks the leading bytes, not the pixels.
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

// Loose on purpose: the tests send unknown kinds and out-of-range values the API must reject.
type Body = {
  occurredAt?: string;
  startedAt?: string;
  endedAt?: string;
  timeZone: string;
  kind?: string;
  value?: number;
  activity?: string;
  durationMinutes?: number;
  distanceM?: number | null;
  energyKcal?: number | null;
  strengthExercises?: { name: string; sets: number; reps: number; weightKg: number | null }[] | null;
  stages?: { awake: number; light: number; deep: number; rem: number } | null;
};

function post(path: string, body: Body, key = randomUUID()) {
  return app.request(path, { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(body) });
}

function remove(path: string, revision: number, key = randomUUID()) {
  return app.request(path, { method: "DELETE", headers: { ...auth, "Idempotency-Key": key, "If-Match": `"${revision}"` } });
}

function upload(image: Buffer, key = randomUUID(), occurredAt = "2026-09-24T08:00:00Z") {
  const form = new FormData();

  form.set("file", new File([new Uint8Array(image)], "progress.png"));
  form.set("occurredAt", occurredAt);
  form.set("timeZone", zone);

  return app.request("/v1/progress-photos", { method: "POST", headers: { ...auth, "Idempotency-Key": key }, body: form });
}

async function overview(date: string, target = app) {
  const response = await target.request(`/v1/overview/${date}`, { headers: auth });

  assert.equal(response.status, 200);

  return response.json();
}

void test("overview combines nutrition, sports, measurements, sleep, and photos", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/overview/2026-09-24")).status, 401);
    assert.equal((await app.request("/v1/overview/yesterday", { headers: auth })).status, 400);

    const empty = await overview("2026-09-24");
    assert.equal(empty.nutrition.food.entryCount, 0);
    assert.equal(empty.nutrition.water.totalMl, null);
    assert.deepEqual(empty.sports, { entries: [], entryCount: 0, totalMinutes: null, energyKcal: null });
    assert.deepEqual(empty.sleep, { sessions: [], totalMinutes: null, stages: null });
    assert.equal(empty.measurements.bmi, null);
    assert.deepEqual(empty.photos, []);

    // Measurements carry forward, and BMI uses the latest weight and height.
    assert.equal((await post("/v1/measurements", { occurredAt: "2026-09-20T08:00:00Z", timeZone: zone, kind: "height", value: 180 })).status, 201);
    assert.equal((await post("/v1/measurements", { occurredAt: "2026-09-20T08:05:00Z", timeZone: zone, kind: "weight", value: 82.4 })).status, 201);
    const weightKey = randomUUID();
    const weight = await post("/v1/measurements", { occurredAt: "2026-09-24T07:30:00Z", timeZone: zone, kind: "weight", value: 81.25 }, weightKey);
    assert.equal(weight.status, 201);
    const weightEntry = await weight.json();

    const retried = await post("/v1/measurements", { occurredAt: "2026-09-24T07:30:00Z", timeZone: zone, kind: "weight", value: 81.25 }, weightKey);
    assert.equal(retried.status, 201);
    assert.deepEqual(await retried.json(), weightEntry);
    assert.equal((await post("/v1/measurements", { occurredAt: "2026-09-24T07:30:00Z", timeZone: zone, kind: "weight", value: 90 }, weightKey)).status, 409);
    assert.equal((await post("/v1/measurements", { occurredAt: "2026-09-24T07:30:00Z", timeZone: zone, kind: "weight", value: 900 })).status, 400);
    assert.equal((await post("/v1/measurements", { occurredAt: "2026-09-24T07:30:00Z", timeZone: zone, kind: "shoe-size", value: 44 })).status, 400);

    let day = await overview("2026-09-24");
    assert.equal(day.measurements.entries.length, 1);
    assert.deepEqual(day.measurements.latest.weight, { value: 81.25, localDate: "2026-09-24" });
    assert.deepEqual(day.measurements.latest.height, { value: 180, localDate: "2026-09-20" });
    assert.equal(day.measurements.latest["body-fat"], null);
    assert.equal(day.measurements.weightChange, -1.15);
    assert.deepEqual(day.measurements.weightHistory, [{ localDate: "2026-09-20", value: 82.4 }, { localDate: "2026-09-24", value: 81.25 }]);
    assert.equal(day.measurements.bmi, 25.1);
    assert.equal((await overview("2026-09-21")).measurements.latest.weight.value, 82.4);

    // Workouts: the energy total is null while any workout lacks an estimate.
    const run = await (await post("/v1/workouts", { occurredAt: "2026-09-24T17:00:00Z", timeZone: zone, activity: "run", durationMinutes: 42, distanceM: 8000, energyKcal: 510 })).json();
    const strengthExercises = [{ name: "Squat", sets: 3, reps: 8, weightKg: 60 }, { name: "Push-up", sets: 3, reps: 12, weightKg: null }];
    assert.equal((await post("/v1/workouts", { occurredAt: "2026-09-24T19:00:00Z", timeZone: zone, activity: "strength", durationMinutes: 50, distanceM: null, energyKcal: null, strengthExercises })).status, 201);
    assert.equal((await post("/v1/workouts", { occurredAt: "2026-09-24T19:00:00Z", timeZone: zone, activity: "run", durationMinutes: 0, distanceM: null, energyKcal: null })).status, 400);
    assert.equal((await post("/v1/workouts", { occurredAt: "2026-09-24T19:00:00Z", timeZone: zone, activity: "strength", durationMinutes: 50, distanceM: 1000, energyKcal: null })).status, 400);
    assert.equal((await post("/v1/workouts", { occurredAt: "2026-09-24T19:00:00Z", timeZone: zone, activity: "run", durationMinutes: 50, distanceM: null, energyKcal: null, strengthExercises })).status, 400);
    day = await overview("2026-09-24");
    assert.equal(day.sports.entryCount, 2);
    assert.equal(day.sports.totalMinutes, 92);
    assert.equal(day.sports.energyKcal, null);
    assert.deepEqual(day.sports.entries[1].strengthExercises, strengthExercises);

    // Sleep belongs to the local date on which it ends.
    const night = await post("/v1/sleep-sessions", { startedAt: "2026-09-23T22:45:00Z", endedAt: "2026-09-24T06:15:00Z", timeZone: zone, stages: { awake: 20, light: 230, deep: 90, rem: 110 } });
    assert.equal(night.status, 201);
    assert.equal((await night.json()).localDate, "2026-09-24");
    assert.equal((await post("/v1/sleep-sessions", { startedAt: "2026-09-24T06:15:00Z", endedAt: "2026-09-23T22:45:00Z", timeZone: zone, stages: null })).status, 400);
    assert.equal((await post("/v1/sleep-sessions", { startedAt: "2026-09-24T13:00:00Z", endedAt: "2026-09-24T13:30:00Z", timeZone: zone, stages: { awake: 0, light: 40, deep: 0, rem: 0 } })).status, 400);
    day = await overview("2026-09-24");
    assert.equal(day.sleep.totalMinutes, 450);
    assert.deepEqual(day.sleep.stages, { awake: 20, light: 230, deep: 90, rem: 110 });

    const nap = await (await post("/v1/sleep-sessions", { startedAt: "2026-09-24T13:00:00Z", endedAt: "2026-09-24T13:30:00Z", timeZone: zone, stages: null })).json();
    day = await overview("2026-09-24");
    assert.equal(day.sleep.totalMinutes, 480);
    assert.equal(day.sleep.stages, null);

    // Photos: the leading bytes decide the type, and a removed photo's bytes are gone.
    const photoKey = randomUUID();
    const uploaded = await upload(png, photoKey);
    assert.equal(uploaded.status, 201);
    const photo = await uploaded.json();
    assert.equal(photo.contentType, "image/png");
    assert.equal(photo.byteSize, png.length);
    assert.deepEqual(await (await upload(png, photoKey)).json(), photo);
    assert.equal((await upload(Buffer.from("not an image"))).status, 415);
    assert.equal((await upload(Buffer.alloc(9 * 1024 * 1024, 1))).status, 413);

    const image = await app.request(`/v1/progress-photos/${photo.id}/image`, { headers: auth });
    assert.equal(image.status, 200);
    assert.equal(image.headers.get("Content-Type"), "image/png");
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
    assert.equal((await otherApp.request(`/v1/progress-photos/${photo.id}/image`, { headers: auth })).status, 404);

    day = await overview("2026-09-24");
    assert.deepEqual(day.photos.map((item: { id: string }) => item.id), [photo.id]);
    assert.deepEqual((await overview("2026-09-23")).photos, []);

    // Deletion follows the same revision and retry rules as water.
    assert.equal((await remove(`/v1/workouts/${run.id}`, 2)).status, 409);
    const deleteKey = randomUUID();
    assert.equal((await remove(`/v1/workouts/${run.id}`, run.revision, deleteKey)).status, 204);
    assert.equal((await remove(`/v1/workouts/${run.id}`, run.revision, deleteKey)).status, 204);
    assert.equal((await remove(`/v1/workouts/${run.id}`, run.revision)).status, 404);
    assert.equal((await remove(`/v1/sleep-sessions/${nap.id}`, nap.revision)).status, 204);
    assert.equal((await remove(`/v1/measurements/${weightEntry.id}`, weightEntry.revision)).status, 204);
    assert.equal((await remove(`/v1/progress-photos/${photo.id}`, photo.revision)).status, 204);
    assert.equal((await app.request(`/v1/progress-photos/${photo.id}/image`, { headers: auth })).status, 404);
    const [erased] = await client`SELECT length(image) AS bytes FROM progress_photos WHERE id = ${photo.id}`;
    assert.equal(erased?.bytes, 0);

    day = await overview("2026-09-24");
    assert.equal(day.sports.entryCount, 1);
    assert.equal(day.sleep.totalMinutes, 450);
    assert.equal(day.measurements.latest.weight.value, 82.4);
    assert.equal(day.measurements.weightChange, null);
    assert.deepEqual(day.photos, []);

    const other = await overview("2026-09-24", otherApp);
    assert.equal(other.sports.entryCount, 0);
    assert.equal(other.measurements.latest.height, null);

    const spec = await (await app.request("/openapi.json")).json();

    for (const path of ["/v1/overview/{date}", "/v1/measurements", "/v1/workouts", "/v1/sleep-sessions", "/v1/progress-photos", "/v1/progress-photos/{id}", "/v1/progress-photos/{id}/image"]) assert.ok(spec.paths[path], path);
  } finally {
    await cleanup();
  }
});
