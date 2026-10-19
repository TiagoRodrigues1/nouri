import assert from "node:assert/strict";
import { test } from "node:test";
import type { Profile } from "../../src/profile/contract.js";
import { suggestTargets } from "../../src/profile/suggest.js";
import { defaultTargets, targetsSchema } from "../../src/targets/contract.js";

const cutting: Profile = { sex: "female", birthYear: 1992, activity: "moderate", weeklyChangeKg: -0.5 };

void test("losing half a kilogram a week takes 550 kcal a day off maintenance and raises protein", () => {
  // Resting 1,399 kcal (Mifflin–St Jeor), times 1.55 for moderate activity; 0.5 kg is 3,850 kcal over a week.
  assert.deepEqual(suggestTargets(cutting, { weightKg: 68, heightCm: 168 }, "2026-10-17"), {
    basis: { age: 34, weightKg: 68, heightCm: 168, maintenanceKcal: 2170, expectedWeeklyChangeKg: -0.5 },
    targets: { kcal: 1620, proteinG: 136, carbsG: 148, fatG: 54, waterMl: 2400 },
  });
});

void test("a gain adds the rate's energy to maintenance", () => {
  const bulking: Profile = { sex: "male", birthYear: 1996, activity: "sedentary", weeklyChangeKg: 0.25 };

  // 0.25 kg a week is 275 kcal a day, rounded to 280.
  assert.deepEqual(suggestTargets(bulking, { weightKg: 80, heightCm: 180 }, "2026-03-01"), {
    basis: { age: 30, weightKg: 80, heightCm: 180, maintenanceKcal: 2140, expectedWeeklyChangeKg: 0.25 },
    targets: { kcal: 2420, proteinG: 144, carbsG: 279, fatG: 81, waterMl: 2800 },
  });
});

void test("maintaining keeps maintenance energy", () => {
  const { basis, targets } = suggestTargets({ ...cutting, weeklyChangeKg: 0 }, { weightKg: 68, heightCm: 168 }, "2026-10-17");

  assert.equal(targets.kcal, basis.maintenanceKcal);
  assert.equal(basis.expectedWeeklyChangeKg, 0);
  assert.equal(targets.proteinG, 109);
});

void test("a cut never goes below resting energy, and says how much slower that makes it", () => {
  const { basis, targets } = suggestTargets({ ...cutting, weeklyChangeKg: -1 }, { weightKg: 68, heightCm: 168 }, "2026-10-17");

  // 1 kg a week would be 1,100 kcal off 2,170; resting energy is 1,399.
  assert.equal(targets.kcal, 1400);
  assert.equal(basis.expectedWeeklyChangeKg, -0.7);

  const small = suggestTargets({ sex: "female", birthYear: 1956, activity: "sedentary", weeklyChangeKg: -0.5 }, { weightKg: 45, heightCm: 150 }, "2026-10-17");

  // Resting is 876.5 kcal, and 550 off 1,050 would be 500.
  assert.equal(small.targets.kcal, 880);
});

void test("protein is capped so the macros fit the energy target", () => {
  const { targets } = suggestTargets({ sex: "female", birthYear: 1926, activity: "sedentary", weeklyChangeKg: -0.5 }, { weightKg: 100, heightCm: 100 }, "2026-10-17");

  // 2 g per kilogram would be 200 g, 800 kcal of a 960 kcal target.
  assert.deepEqual(targets, { kcal: 960, proteinG: 84, carbsG: 84, fatG: 32, waterMl: 3500 });
});

void test("suggestions stay within the target limits and the energy target for extreme bodies", () => {
  for (const body of [{ weightKg: 20, heightCm: 50 }, { weightKg: 500, heightCm: 272 }]) {
    for (const weeklyChangeKg of [-1, 0, 0.5]) {
      const { targets } = suggestTargets({ ...cutting, weeklyChangeKg, activity: "very-active" }, body, "2026-10-17");

      assert.ok(targetsSchema.safeParse({ ...defaultTargets, ...targets }).success, `${weeklyChangeKg} kg a week for ${body.weightKg} kg`);
      // Rounding each macro to a gram moves the total by a few kcal at most.
      assert.ok(Math.abs(targets.proteinG * 4 + targets.carbsG * 4 + targets.fatG * 9 - targets.kcal) <= 10, `${weeklyChangeKg} kg a week for ${body.weightKg} kg adds up`);
    }
  }
});
