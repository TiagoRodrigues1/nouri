import assert from "node:assert/strict";
import { test } from "node:test";
import { coach } from "../../src/coaching/coaching.js";
import type { ReviewPeriod } from "../../src/review/contract.js";

const none = { average: null, averageTarget: null, daysOnTarget: 0 };

// A week where every kind was recorded and on target, so nothing is suggested.
const steady: ReviewPeriod = {
  from: "2026-09-24",
  to: "2026-09-30",
  recordedDays: { food: 7, water: 7, supplements: 7, workouts: 3, sleep: 7, weight: 2, any: 7 },
  nutrition: {
    completeDays: 7,
    kcal: { average: 2000, averageTarget: 2000, daysOnTarget: 7 },
    proteinG: { average: 130, averageTarget: 120, daysOnTarget: 6 },
  },
  water: { average: 2200, averageTarget: 2000, daysOnTarget: 6 },
  sleep: { average: 470, averageTarget: 480, daysOnTarget: 3 },
  supplements: { dueDays: 7, fullDays: 6 },
  workouts: { count: 3, totalMinutes: 150 },
  weightKg: 80,
};

function kinds(week: ReviewPeriod) {
  return coach(week).map((suggestion) => suggestion.kind);
}

void test("a week on target gets no suggestions", () => {
  assert.deepEqual(coach(steady), []);
});

void test("a week with nothing recorded gets no suggestions", () => {
  assert.deepEqual(coach({ ...steady, recordedDays: { food: 0, water: 0, supplements: 0, workouts: 0, sleep: 0, weight: 0, any: 0 }, nutrition: { completeDays: 0, kcal: none, proteinG: none } }), []);
});

void test("sparse food records block calorie and protein suggestions", () => {
  const sparse = { ...steady, nutrition: { completeDays: 3, kcal: { average: 3000, averageTarget: 2000, daysOnTarget: 0 }, proteinG: { average: 40, averageTarget: 120, daysOnTarget: 0 } } };
  const [suggestion] = coach(sparse);

  assert.deepEqual(kinds(sparse), ["log-food"]);
  assert.equal(suggestion?.because, "Complete food records on 3 of 7 days. Nouri compares calories and protein once 4 days are complete.");
});

void test("protein short on most complete days and calories outside the band are named with their evidence", () => {
  const week = { ...steady, nutrition: { completeDays: 5, kcal: { average: 2350, averageTarget: 2000, daysOnTarget: 1 }, proteinG: { average: 95.4, averageTarget: 120, daysOnTarget: 2 } } };
  const [protein, calories] = coach(week);

  assert.deepEqual(kinds(week), ["protein", "calories"]);
  assert.equal(protein?.because, "Protein reached target on 2 of 5 days, averaging 95 g against 120 g.");
  assert.equal(calories?.title, "Trim a portion or a snack");
  assert.equal(calories?.because, "They averaged 2,350 kcal against 2,000 kcal, within 10% on 1 of 5 days.");
  assert.equal(coach({ ...week, nutrition: { ...week.nutrition, kcal: { average: 1500, averageTarget: 2000, daysOnTarget: 0 } } })[1]?.title, "Add a snack on lighter days");
});

void test("calories within the band leave no calorie suggestion", () => {
  assert.deepEqual(kinds({ ...steady, nutrition: { ...steady.nutrition, kcal: { average: 2190, averageTarget: 2000, daysOnTarget: 4 } } }), []);
});

void test("sleep needs enough nights and a real shortfall", () => {
  const short = { ...steady, sleep: { average: 400, averageTarget: 480, daysOnTarget: 0 } };

  assert.deepEqual(kinds(short), ["sleep"]);
  assert.equal(coach(short)[0]?.because, "Sleep averaged 6 h 40 min over 7 nights, against a target of 8 h 0 min.");
  assert.deepEqual(kinds({ ...short, recordedDays: { ...short.recordedDays, sleep: 3 } }), []);
  assert.deepEqual(kinds({ ...short, sleep: { ...short.sleep, average: 451 } }), []);
});

void test("water and supplements need enough days and fall short on most of them", () => {
  assert.deepEqual(kinds({ ...steady, water: { average: 1200, averageTarget: 2000, daysOnTarget: 3 } }), ["water"]);
  assert.deepEqual(kinds({ ...steady, recordedDays: { ...steady.recordedDays, water: 3 }, water: { average: 1200, averageTarget: 2000, daysOnTarget: 0 } }), []);
  assert.deepEqual(kinds({ ...steady, supplements: { dueDays: 7, fullDays: 3 } }), ["supplements"]);
  assert.deepEqual(kinds({ ...steady, supplements: { dueDays: 3, fullDays: 0 } }), []);
});
