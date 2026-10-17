import assert from "node:assert/strict";
import { test } from "node:test";
import type { Profile } from "../../src/profile/contract.js";
import { suggestTargets } from "../../src/profile/suggest.js";
import { defaultTargets, targetsSchema } from "../../src/targets/contract.js";

const cutting: Profile = { sex: "female", birthYear: 1992, activity: "moderate", goal: "lose" };

void test("a cut takes a fifth off maintenance energy and raises protein", () => {
  // Resting 1,399 kcal (Mifflin–St Jeor), times 1.55 for moderate activity.
  assert.deepEqual(suggestTargets(cutting, { weightKg: 68, heightCm: 168 }, "2026-10-17"), {
    basis: { age: 34, weightKg: 68, heightCm: 168, maintenanceKcal: 2170 },
    targets: { kcal: 1730, proteinG: 136, carbsG: 166, fatG: 58, waterMl: 2400 },
  });
});

void test("a gain adds a tenth to maintenance energy", () => {
  const bulking: Profile = { sex: "male", birthYear: 1996, activity: "sedentary", goal: "gain" };

  assert.deepEqual(suggestTargets(bulking, { weightKg: 80, heightCm: 180 }, "2026-03-01"), {
    basis: { age: 30, weightKg: 80, heightCm: 180, maintenanceKcal: 2140 },
    targets: { kcal: 2350, proteinG: 144, carbsG: 268, fatG: 78, waterMl: 2800 },
  });
});

void test("maintaining keeps maintenance energy", () => {
  const { basis, targets } = suggestTargets({ ...cutting, goal: "maintain" }, { weightKg: 68, heightCm: 168 }, "2026-10-17");

  assert.equal(targets.kcal, basis.maintenanceKcal);
  assert.equal(targets.proteinG, 109);
});

void test("a cut never goes below resting energy", () => {
  const { targets } = suggestTargets({ sex: "female", birthYear: 1956, activity: "sedentary", goal: "lose" }, { weightKg: 45, heightCm: 150 }, "2026-10-17");

  // Resting is 876.5 kcal; a fifth off 1.2 times that would be 841.
  assert.equal(targets.kcal, 880);
});

void test("suggestions stay within the target limits for extreme bodies", () => {
  for (const body of [{ weightKg: 20, heightCm: 50 }, { weightKg: 500, heightCm: 272 }]) {
    for (const goal of ["lose", "maintain", "gain"] as const) {
      const { targets } = suggestTargets({ ...cutting, goal, activity: "very-active" }, body, "2026-10-17");

      assert.ok(targetsSchema.safeParse({ ...defaultTargets, ...targets }).success, `${goal} for ${body.weightKg} kg`);
    }
  }
});
