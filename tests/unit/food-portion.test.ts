import assert from "node:assert/strict";
import { test } from "node:test";
import { portionFood, sourceOf } from "../../frontend/src/lib/food-portion.js";
import type { RecordedFood } from "../../src/food/contract.js";

const ref = { provider: "ciqual" as const, id: "13039", version: "2025" };

void test("a catalog portion previews nutrients but sends the reference for server measurement", () => {
  const basis: RecordedFood = {
    name: "Apple",
    quantity: { amount: 100, unit: "g" },
    nutrients: { kcal: 52, proteinG: 0.3, carbsG: 11.6, fatG: 0.2 },
    catalogRef: ref,
  };

  const portion = portionFood(sourceOf({ kind: "catalog", ref, quantity: { amount: 100, unit: "g" } }, basis), 150);

  assert.deepEqual(portion.submitted, { kind: "catalog", ref, quantity: { amount: 150, unit: "g" } });
  assert.deepEqual(portion.preview, {
    ...basis,
    quantity: { amount: 150, unit: "g" },
    nutrients: { kcal: 78, proteinG: 0.45, carbsG: 17.4, fatG: 0.3 },
  });
});

void test("a catalog submission cannot be paired with another food's preview", () => {
  const other = { ...ref, id: "other" };

  const preview: RecordedFood = {
    name: "Apple",
    quantity: { amount: 100, unit: "g" },
    nutrients: { kcal: 52, proteinG: 0.3, carbsG: 11.6, fatG: 0.2 },
    catalogRef: other,
  };

  assert.throws(() => sourceOf({ kind: "catalog", ref, quantity: { amount: 100, unit: "g" } }, preview), /does not match/);
  assert.throws(() => sourceOf({ kind: "catalog", ref: other, quantity: { amount: 150, unit: "g" } }, preview), /does not match/);
});

void test("a label portion sends the scaled snapshot with its source and unknown nutrients", () => {
  const basis: RecordedFood = {
    name: "Yogurt",
    quantity: { amount: 100, unit: "ml" },
    nutrients: { kcal: 60, proteinG: 3.5, carbsG: null, fatG: 0.5 },
    catalogRef: { provider: "nouri", id: "food-1" },
  };

  const portion = portionFood({ kind: "label", basis }, 125);

  assert.deepEqual(portion.preview, {
    ...basis,
    quantity: { amount: 125, unit: "ml" },
    nutrients: { kcal: 75, proteinG: 4.375, carbsG: null, fatG: 0.625 },
  });
  assert.deepEqual(portion.submitted, { ...portion.preview, catalogRef: basis.catalogRef });
});
