import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { defaultTargets } from "../../src/targets/contract.js";

const { app, otherApp, headers, setup, cleanup } = createHarness();

const profile = { sex: "female", birthYear: 1992, activity: "moderate", goal: "lose" };

// Loose on purpose: the tests send unknown values, extra fields, and missing fields the API must reject.
type ProfileRequest = Record<string, string | number | boolean>;

function put(date: string, body: ProfileRequest) {
  return app.request(`/v1/profile/${date}`, { method: "PUT", headers, body: JSON.stringify(body) });
}

async function get(date: string, target = app) {
  const response = await target.request(`/v1/profile/${date}`, { headers });

  assert.equal(response.status, 200);

  return response.json();
}

function measure(occurredAt: string, kind: string, value: number) {
  return app.request("/v1/measurements", {
    method: "POST",
    headers: { ...headers, "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ occurredAt, timeZone: "Europe/Lisbon", kind, value }),
  });
}

void test("a saved profile suggests nutrition targets from the latest weight and height", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/profile/2026-10-17")).status, 401);
    assert.deepEqual(await get("2026-10-17"), { profile: null, suggestion: null, missing: ["profile", "weight", "height"] });

    // Saving without a height keeps the profile and names what the suggestion still needs.
    assert.equal((await measure("2026-10-01T08:00:00Z", "weight", 70)).status, 201);
    const saved = await put("2026-10-17", profile);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { profile, suggestion: null, missing: ["height"] });

    assert.equal((await measure("2026-10-02T08:00:00Z", "height", 168)).status, 201);
    assert.equal((await measure("2026-10-10T08:00:00Z", "weight", 68)).status, 201);

    // The weight in force on the day: 70 kg before the 10th, 68 kg from then on.
    const today = await get("2026-10-17");
    assert.deepEqual(today, {
      profile,
      suggestion: {
        basis: { age: 34, weightKg: 68, heightCm: 168, maintenanceKcal: 2170 },
        targets: { kcal: 1730, proteinG: 136, carbsG: 166, fatG: 58, waterMl: 2400 },
      },
      missing: [],
    });
    assert.equal((await get("2026-10-05")).suggestion.basis.weightKg, 70);
    assert.deepEqual((await get("2026-10-01")).missing, ["height"]);

    // A suggestion leaves the saved targets alone.
    assert.deepEqual((await (await app.request("/v1/targets/2026-10-17", { headers })).json()).targets, defaultTargets);

    // Saving again replaces the profile.
    const gaining = { ...profile, goal: "gain" };
    assert.equal((await put("2026-10-17", gaining)).status, 200);
    assert.deepEqual((await get("2026-10-17")).profile, gaining);
    assert.deepEqual(await get("2026-10-17", otherApp), { profile: null, suggestion: null, missing: ["profile", "weight", "height"] });

    for (const invalid of [{ ...profile, sex: "other" }, { ...profile, activity: "extreme" }, { ...profile, birthYear: 1992.5 }, { ...profile, extra: true }, { sex: "male" }]) {
      assert.equal((await put("2026-10-17", invalid)).status, 400);
    }

    assert.equal((await put("2026-13-01", profile)).status, 400);
    assert.equal((await app.request("/v1/profile/today", { headers })).status, 400);
    assert.deepEqual((await get("2026-10-17")).profile, gaining);

    const spec = await (await app.request("/openapi.json")).json();
    assert.ok(spec.paths["/v1/profile/{date}"].get);
    assert.ok(spec.paths["/v1/profile/{date}"].put);
  } finally {
    await cleanup();
  }
});
