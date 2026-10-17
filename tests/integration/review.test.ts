import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { z } from "zod";
import type { FoodInput } from "../../src/food/contract.js";
import type { MeasurementInput } from "../../src/measurements/contract.js";
import type { IntakeInput } from "../../src/supplements/contract.js";
import type { WaterInput } from "../../src/water/contract.js";
import { defaultTargets } from "../../src/targets/contract.js";
import type { SleepInput } from "../../src/sleep/contract.js";
import type { workoutInputSchema } from "../../src/workouts/contract.js";

let { app, otherApp, token, setup, cleanup } = createHarness();

const auth = { Authorization: `Bearer ${token}` };

const zone = "Europe/Lisbon";

type Body = FoodInput | z.input<typeof workoutInputSchema> | SleepInput | MeasurementInput | WaterInput | IntakeInput;

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
    assert.deepEqual(empty.days[0], {
      date: "2026-09-24",
      food: { entryCount: 0, kcal: null, proteinG: null },
      water: { entryCount: 0, totalMl: null },
      supplements: { intakeCount: 0, taken: 0, stackSize: 0 },
      workouts: { entryCount: 0, totalMinutes: null },
      sleep: { sessionCount: 0, totalMinutes: null },
      weightKg: null,
      targets: { kcal: 2000, proteinG: 50, waterMl: 2000, sleepMinutes: 480 },
    });
    assert.deepEqual(empty.recordedDays, { food: 0, water: 0, supplements: 0, workouts: 0, sleep: 0, weight: 0, any: 0 });
    // Nothing recorded, so nothing to suggest.
    assert.deepEqual(empty.suggestions, []);
    const nothing = { average: null, averageTarget: null, daysOnTarget: 0 };
    assert.deepEqual(empty.nutrition, { completeDays: 0, kcal: nothing, proteinG: nothing });

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
    assert.deepEqual(week.recordedDays, { food: 2, water: 0, supplements: 0, workouts: 1, sleep: 1, weight: 1, any: 5 });
    // The 30th lacks a protein value, so only the 24th is compared, against the default targets.
    assert.deepEqual(week.nutrition, {
      completeDays: 1,
      kcal: { average: 900.5, averageTarget: 2000, daysOnTarget: 0 },
      proteinG: { average: 43.25, averageTarget: 50, daysOnTarget: 0 },
    });

    // Moving the window drops days that fall out of it.
    const earlier = await review("2026-09-24");
    assert.equal(earlier.from, "2026-09-18");
    assert.equal(earlier.days[2].weightKg, 83);
    assert.deepEqual(earlier.days[5].food, { entryCount: 1, kcal: 999, proteinG: 99 });
    assert.deepEqual(earlier.recordedDays, { food: 2, water: 0, supplements: 0, workouts: 0, sleep: 0, weight: 1, any: 3 });

    // A longer range reaches back past the week, and only the listed ranges are accepted.
    const month = await review("2026-09-30?days=30");
    assert.equal(month.from, "2026-09-01");
    assert.equal(month.days.length, 30);
    assert.deepEqual(month.days.flatMap((day: { date: string; weightKg: number | null }) => day.weightKg === null ? [] : [[day.date, day.weightKg]]), [["2026-09-20", 83], ["2026-09-28", 82.1]]);
    assert.deepEqual(month.recordedDays, { food: 3, water: 0, supplements: 0, workouts: 1, sleep: 1, weight: 2, any: 7 });
    assert.equal((await review("2026-09-30?days=14")).days.length, 14);
    assert.equal((await review("2026-09-30?days=90")).from, "2026-07-03");

    for (const days of ["10", "365", "week"]) {
      assert.equal((await app.request(`/v1/review/2026-09-30?days=${days}`, { headers: auth })).status, 400);
    }

    const other = await review("2026-09-30", otherApp);
    assert.deepEqual(other.recordedDays, { food: 1, water: 0, supplements: 0, workouts: 0, sleep: 0, weight: 0, any: 1 });
    assert.deepEqual(other.days[3].food, { entryCount: 1, kcal: 700, proteinG: 40 });
  } finally {
    await cleanup();
  }
});

void test("review compares each complete food day with the targets in force that day", async () => {
  ({ app, otherApp, token, setup, cleanup } = createHarness());
  await setup();

  try {
    const putTargets = async (date: string, kcal: number, proteinG: number) => {
      const response = await app.request(`/v1/targets/${date}`, { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ ...defaultTargets, kcal, proteinG }) });
      assert.equal(response.status, 200);
    };

    // Set before the window, then changed from the 27th.
    await putTargets("2026-09-20", 1800, 120);
    await putTargets("2026-09-27", 2200, 100);

    // Within 10% of 1,800 and above 120 g.
    await post("/v1/food-entries", food("2026-09-25T12:00:00Z", 1700, 130));
    // 300 over 2,200 and short of 100 g.
    await post("/v1/food-entries", food("2026-09-28T12:00:00Z", 2500, 90));
    // Within 10% of 2,200 and exactly 100 g.
    await post("/v1/food-entries", food("2026-09-29T12:00:00Z", 2100, 100));
    // A food without calories leaves the 30th incomplete, so it is not compared.
    await post("/v1/food-entries", food("2026-09-30T12:00:00Z", null, 60));

    const week = await review("2026-09-30");

    assert.deepEqual(week.days.map((day: { targets: { kcal: number; proteinG: number } }) => [day.targets.kcal, day.targets.proteinG]), [
      [1800, 120], [1800, 120], [1800, 120], [2200, 100], [2200, 100], [2200, 100], [2200, 100],
    ]);
    assert.equal(week.recordedDays.food, 4);
    assert.equal(week.nutrition.completeDays, 3);
    assert.equal(week.nutrition.kcal.average, 2100);
    assert.equal(week.nutrition.kcal.averageTarget.toFixed(2), "2066.67");
    assert.equal(week.nutrition.kcal.daysOnTarget, 2);
    assert.equal(week.nutrition.proteinG.average.toFixed(2), "106.67");
    assert.equal(week.nutrition.proteinG.averageTarget.toFixed(2), "106.67");
    assert.equal(week.nutrition.proteinG.daysOnTarget, 2);

    // Another user's targets stay at the defaults.
    const other = await review("2026-09-30", otherApp);
    assert.deepEqual(other.days[6].targets, { kcal: 2000, proteinG: 50, waterMl: 2000, sleepMinutes: 480 });
  } finally {
    await cleanup();
  }
});

void test("review adds water and supplements to the timeline, splits weeks, and suggests from the last one", async () => {
  ({ app, otherApp, token, setup, cleanup } = createHarness());
  await setup();

  try {
    const vitaminD = { id: randomUUID(), name: "Vitamin D", kind: "vitamin", dose: { amount: 1000, unit: "IU" } };
    const creatine = { id: randomUUID(), name: "Creatine", kind: "creatine", dose: { amount: 5, unit: "g" } };
    const stack = await app.request("/v1/supplement-stack/2026-09-20", { method: "PUT", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ supplements: [vitaminD, creatine] }) });
    assert.equal(stack.status, 200);

    // Water short of the 2,000 ml default on four days of the last week, and reached on one.
    for (const [date, volumeMl] of [["2026-09-24", 800], ["2026-09-25", 1000], ["2026-09-26", 1200], ["2026-09-27", 900], ["2026-09-28", 2100]] as const) {
      await post("/v1/water-entries", { occurredAt: `${date}T09:00:00Z`, timeZone: zone, volumeMl: volumeMl - 300 });
      await post("/v1/water-entries", { occurredAt: `${date}T15:00:00Z`, timeZone: zone, volumeMl: 300 });
    }

    // A week earlier, every day reached target.
    for (let day = 17; day <= 23; day += 1) await post("/v1/water-entries", { occurredAt: `2026-09-${day}T09:00:00Z`, timeZone: zone, volumeMl: 2500 });

    // Both supplements on the 24th, one on the 25th, both on the 30th.
    await post("/v1/supplement-intakes", { occurredAt: "2026-09-24T08:00:00Z", timeZone: zone, supplementId: vitaminD.id });
    await post("/v1/supplement-intakes", { occurredAt: "2026-09-24T08:00:00Z", timeZone: zone, supplementId: creatine.id });
    await post("/v1/supplement-intakes", { occurredAt: "2026-09-25T08:00:00Z", timeZone: zone, supplementId: creatine.id });
    await post("/v1/supplement-intakes", { occurredAt: "2026-09-30T08:00:00Z", timeZone: zone, supplementId: vitaminD.id });
    await post("/v1/supplement-intakes", { occurredAt: "2026-09-30T08:00:00Z", timeZone: zone, supplementId: creatine.id });

    const week = await review("2026-09-30");
    const [d24, d25, , , d28, d29] = week.days;

    assert.deepEqual(d24.water, { entryCount: 2, totalMl: 800 });
    assert.deepEqual(d28.water, { entryCount: 2, totalMl: 2100 });
    assert.deepEqual(d29.water, { entryCount: 0, totalMl: null });
    assert.deepEqual(d24.supplements, { intakeCount: 2, taken: 2, stackSize: 2 });
    assert.deepEqual(d25.supplements, { intakeCount: 1, taken: 1, stackSize: 2 });
    assert.deepEqual(d29.supplements, { intakeCount: 0, taken: 0, stackSize: 2 });
    assert.equal(week.recordedDays.water, 5);
    assert.equal(week.recordedDays.supplements, 3);
    assert.equal(week.recordedDays.any, 6);
    assert.deepEqual(week.water, { average: 1200, averageTarget: 2000, daysOnTarget: 1 });
    assert.deepEqual(week.supplements, { stackDays: 7, fullDays: 2 });

    // A week is one whole week, and its summary matches the range.
    assert.equal(week.weeks.length, 1);
    assert.deepEqual(week.weeks[0], { from: week.from, to: week.to, recordedDays: week.recordedDays, nutrition: week.nutrition, water: week.water, sleep: week.sleep, supplements: week.supplements, workouts: week.workouts, weightKg: week.weightKg });

    // No food logged, so food rules ask for records; water and supplements fell short.
    assert.deepEqual(week.suggestions.map((suggestion: { kind: string }) => suggestion.kind), ["log-food", "water", "supplements"]);
    assert.match(week.suggestions[1].because, /reached target on 1 of 5 days, averaging 1,200 ml against 2,000 ml/);

    // Thirty days hold four whole weeks; the two days before them belong to none.
    const month = await review("2026-09-30?days=30");
    assert.deepEqual(month.weeks.map((period: { from: string; to: string }) => [period.from, period.to]), [
      ["2026-09-03", "2026-09-09"], ["2026-09-10", "2026-09-16"], ["2026-09-17", "2026-09-23"], ["2026-09-24", "2026-09-30"],
    ]);
    assert.deepEqual(month.weeks[2].water, { average: 2500, averageTarget: 2000, daysOnTarget: 7 });
    assert.deepEqual(month.weeks[3].water, week.water);
    // The stack took effect on the 20th, so the third week has four stack days and none full.
    assert.deepEqual(month.weeks[2].supplements, { stackDays: 4, fullDays: 0 });
    assert.deepEqual(month.suggestions, week.suggestions);

    const other = await review("2026-09-30", otherApp);
    assert.deepEqual(other.supplements, { stackDays: 0, fullDays: 0 });
    assert.equal(other.recordedDays.water, 0);
  } finally {
    await cleanup();
  }
});
