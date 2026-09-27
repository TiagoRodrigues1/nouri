import assert from "node:assert/strict";
import { test } from "node:test";
import { draftFor, editableRef, editedSubmission, scaleNutrients } from "../../frontend/src/lib/food-edit.js";
import type { FoodEntry } from "../food/contract.js";

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const manual: FoodEntry = {
  id: "7d7b2f0a-3f64-4d8e-9a55-0d3c0e6b1c11",
  revision: 3,
  occurredAt: "2026-09-24T11:30:00.000Z",
  timeZone: "Pacific/Kiritimati",
  localDate: "2026-09-25",
  food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 311, proteinG: 13, carbsG: null, fatG: 5 }, catalogRef: null },
};

const catalog: FoodEntry = {
  ...manual,
  food: { ...manual.food, name: "Apple", catalogRef: { provider: "ciqual", id: "13039", version: "2025" } },
};

void test("an unchanged time keeps the recorded instant and zone", () => {
  const input = editedSubmission(manual, { ...draftFor(manual), amount: "120" });

  assert.equal(input.occurredAt, manual.occurredAt);
  assert.equal(input.timeZone, manual.timeZone);
});

void test("a new time stays on the entry's local date in the browser's zone", () => {
  const input = editedSubmission(manual, { ...draftFor(manual), time: "08:15" });
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(input.occurredAt));

  assert.equal(input.timeZone, zone);
  assert.equal(local, "2026-09-25, 08:15");
});

void test("a catalog entry sends its reference and grams for the server to recalculate", () => {
  const input = editedSubmission(catalog, { ...draftFor(catalog), amount: "150", nutrients: { kcal: "1", proteinG: "1", carbsG: "1", fatG: "1" } });

  assert.deepEqual(input.food, { kind: "catalog", ref: { provider: "ciqual", id: "13039", version: "2025" }, quantity: { amount: 150, unit: "g" } });
});

void test("a ciqual reference without a version edits as manual food", () => {
  const entry: FoodEntry = { ...catalog, food: { ...catalog.food, catalogRef: { provider: "ciqual", id: "13039" } } };
  assert.equal(editableRef(entry).catalog, null);
  assert.deepEqual(editedSubmission(entry, draftFor(entry)).food, {
    name: "Apple", quantity: entry.food.quantity, nutrients: entry.food.nutrients,
  });
});

void test("a manual entry sends its fields, with an empty nutrient as unknown", () => {
  const input = editedSubmission(manual, { ...draftFor(manual), name: " Rolled oats ", nutrients: { kcal: "300", proteinG: "", carbsG: "", fatG: "0" } });

  assert.deepEqual(input.food, { name: "Rolled oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: null, carbsG: null, fatG: 0 } });
});

void test("scaling keeps unknown values unknown and rounds to the stored precision", () => {
  assert.deepEqual(scaleNutrients({ kcal: "311", proteinG: "13", carbsG: "", fatG: "5" }, 80, 120), { kcal: "466.5", proteinG: "19.5", carbsG: "", fatG: "7.5" });
  assert.deepEqual(scaleNutrients({ kcal: "10", proteinG: "1", carbsG: "0", fatG: "" }, 3, 1), { kcal: "3.333", proteinG: "0.333", carbsG: "0", fatG: "" });
});
