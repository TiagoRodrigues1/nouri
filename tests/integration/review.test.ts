import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { z } from "zod";
import type { FoodInput } from "../../src/food/contract.js";
import type { MeasurementInput } from "../../src/measurements/contract.js";
import type { SleepInput } from "../../src/sleep/contract.js";
import type { workoutInputSchema } from "../../src/workouts/contract.js";

const { app, otherApp, token, setup, cleanup } = createHarness();

const auth = { Authorization: `Bearer ${token}` };

const zone = "Europe/Lisbon";

type Body = FoodInput | z.input<typeof workoutInputSchema> | SleepInput | MeasurementInput;

async function post(path: string, body: Body, target = app) {
  const response = await target.request(path, { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });

  assert.equal(response.status, 201);

  return response.json();
}

function food(occurredAt: string, kcal: number | null, proteinG: number | null): FoodInput {
  return { occurredAt, timeZone: zone, food: { name: "Test food", quantity: { amount: 100, unit: "g" }, nutrients: { kcal, proteinG, carbsG: null, fatG: null } } };
}

function workout(occurredAt: string, durationMinutes: number): z.input<typeof workoutInputSchema> {
  return { occurredAt, timeZone: zone, activity: "run", durationMinutes, distanceM: null, energyKcal: null };
}

async function review(date: string, target = app) {
  const response = await target.request(`/v1/review/${date}`, { headers: auth });

  assert.equal(response.status, 200);

  return response.json();
}

void test("review lists seven days and leaves unrecorded ones null", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/review/2026-09-30")).status, 401);
    assert.equal((await app.request("/v1/review/last-week", { headers: auth })).status, 400);

    const empty = await review("2026-09-30");
    assert.equal(empty.from, "2026-09-24");
    assert.equal(empty.to, "2026-09-30");
    assert.deepEqual(empty.days.map((day: { date: string }) => day.date), ["2026-09-24", "2026-09-25", "2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]);
    assert.deepEqual(empty.days[0], { date: "2026-09-24", food: { entryCount: 0, kcal: null, proteinG: null }, workouts: { entryCount: 0, totalMinutes: null }, sleep: { sessionCount: 0, totalMinutes: null }, weightKg: null });
    assert.deepEqual(empty.recordedDays, { food: 0, workouts: 0, sleep: 0, weight: 0, any: 0 });

    // Food on the 24th and 30th; the second food on the 30th lacks protein, so that total is unknown.
    await post("/v1/food-entries", food("2026-09-24T08:00:00Z", 300.5, 12));
    await post("/v1/food-entries", food("2026-09-24T12:00:00Z", 500, 30.25));
    await post("/v1/food-entries", food("2026-09-30T12:00:00Z", 400, 20));
    await post("/v1/food-entries", food("2026-09-30T19:00:00Z", 250, null));
    // 23:30 UTC on the 22nd is 00:30 in Lisbon on the 23rd, a day before the window.
    await post("/v1/food-entries", food("2026-09-22T23:30:00Z", 999, 99));
    // 23:30 UTC on the 23rd is the 24th in Lisbon, so it lands inside the window.
    await post("/v1/food-entries", food("2026-09-23T23:30:00Z", 100, 1));

    await post("/v1/workouts", workout("2026-09-25T18:00:00Z", 30));
    await post("/v1/workouts", workout("2026-09-25T19:00:00Z", 45));
    const removed = await post("/v1/workouts", workout("2026-09-27T18:00:00Z", 60));
    assert.equal((await app.request(`/v1/workouts/${removed.id}`, { method: "DELETE", headers: { ...auth, "Idempotency-Key": randomUUID(), "If-Match": `"${removed.revision}"` } })).status, 204);

    // The night of the 25th counts toward the 26th, when it ends.
    await post("/v1/sleep-sessions", { startedAt: "2026-09-25T22:30:00Z", endedAt: "2026-09-26T06:45:00Z", timeZone: zone, stages: null });
    await post("/v1/sleep-sessions", { startedAt: "2026-09-26T13:00:00Z", endedAt: "2026-09-26T13:30:00Z", timeZone: zone, stages: null });

    // The last weight of a day counts. Earlier weights and other measurements do not fill later days.
    await post("/v1/measurements", { occurredAt: "2026-09-20T07:00:00Z", timeZone: zone, kind: "weight", value: 83 });
    await post("/v1/measurements", { occurredAt: "2026-09-28T07:00:00Z", timeZone: zone, kind: "weight", value: 81.4 });
    await post("/v1/measurements", { occurredAt: "2026-09-28T20:00:00Z", timeZone: zone, kind: "weight", value: 82.1 });
    await post("/v1/measurements", { occurredAt: "2026-09-29T07:00:00Z", timeZone: zone, kind: "waist", value: 85 });

    await post("/v1/food-entries", food("2026-09-27T12:00:00Z", 700, 40), otherApp);

    const week = await review("2026-09-30");
    const [d24, d25, d26, d27, d28, d29, d30] = week.days;

    assert.deepEqual(d24.food, { entryCount: 3, kcal: 900.5, proteinG: 43.25 });
    assert.deepEqual(d30.food, { entryCount: 2, kcal: 650, proteinG: null });
    assert.deepEqual(d27.food, { entryCount: 0, kcal: null, proteinG: null });

    for (const day of [d24, d27, d30]) {
      const response = await app.request(`/v1/days/${day.date}`, { headers: auth });
      assert.equal(response.status, 200);
      const daily = await response.json();

      assert.deepEqual(day.food, {
        entryCount: daily.food.entryCount,
        kcal: daily.food.totals.kcal,
        proteinG: daily.food.totals.proteinG,
      });
    }

    assert.deepEqual(d25.workouts, { entryCount: 2, totalMinutes: 75 });
    assert.deepEqual(d27.workouts, { entryCount: 0, totalMinutes: null });
    assert.deepEqual(d25.sleep, { sessionCount: 0, totalMinutes: null });
    assert.deepEqual(d26.sleep, { sessionCount: 2, totalMinutes: 525 });
    assert.equal(d28.weightKg, 82.1);
    assert.equal(d29.weightKg, null);
    assert.equal(d24.weightKg, null);
    assert.deepEqual(week.recordedDays, { food: 2, workouts: 1, sleep: 1, weight: 1, any: 5 });

    // Moving the window drops days that fall out of it.
    const earlier = await review("2026-09-24");
    assert.equal(earlier.from, "2026-09-18");
    assert.equal(earlier.days[2].weightKg, 83);
    assert.deepEqual(earlier.days[5].food, { entryCount: 1, kcal: 999, proteinG: 99 });
    assert.deepEqual(earlier.recordedDays, { food: 2, workouts: 0, sleep: 0, weight: 1, any: 3 });

    const other = await review("2026-09-30", otherApp);
    assert.deepEqual(other.recordedDays, { food: 1, workouts: 0, sleep: 0, weight: 0, any: 1 });
    assert.deepEqual(other.days[3].food, { entryCount: 1, kcal: 700, proteinG: 40 });
  } finally {
    await cleanup();
  }
});
