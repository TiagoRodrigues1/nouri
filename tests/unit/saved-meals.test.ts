import assert from "node:assert/strict";
import { test } from "node:test";
import { draftItems, draftRow, rowFood } from "../../frontend/src/lib/saved-meals.js";
import { scaleFood, totalNutrients, type RecordedFood } from "../../src/food/contract.js";

const oats: RecordedFood = { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 0.001 }, catalogRef: null };

const yogurt: RecordedFood = {
  name: "Yogurt",
  quantity: { amount: 1, unit: "serving", servingSize: { amount: 125, unit: "g" } },
  nutrients: { kcal: 90, proteinG: 5, carbsG: 6, fatG: 4 },
  catalogRef: { provider: "open-food-facts", id: "301" },
};

const items = [{ id: "a", food: oats }, { id: "b", food: yogurt }];

void test("scaling keeps unknown values unknown and rounds to the thousandth", () => {
  const scaled = scaleFood(oats, 60);

  assert.deepEqual(scaled.quantity, { amount: 60, unit: "g" });
  assert.deepEqual(scaled.nutrients, { kcal: 225, proteinG: 7.5, carbsG: null, fatG: 0.001 });
  assert.equal(scaleFood(oats, 40).nutrients.fatG, 0.001);
  assert.equal(scaleFood(oats, 10).nutrients.fatG, 0);
});

void test("scaling servings keeps the serving size and catalog reference", () => {
  const scaled = scaleFood(yogurt, 2);

  assert.deepEqual(scaled.quantity, { amount: 2, unit: "serving", servingSize: { amount: 125, unit: "g" } });
  assert.equal(scaled.nutrients.kcal, 180);
  assert.deepEqual(scaled.catalogRef, yogurt.catalogRef);
});

void test("a half-typed amount previews the saved amount rather than zero", () => {
  const row = draftRow({ kind: "saved", id: "a" }, items[0]!.food);

  assert.equal(rowFood({ ...row, amount: "" }).nutrients.kcal, 300);
});

// The meal editor's rows.
const draftOats: RecordedFood = { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: 50, fatG: 5 }, catalogRef: null };

const apple: RecordedFood = {
  name: "Apple", quantity: { amount: 100, unit: "g" }, nutrients: { kcal: 52, proteinG: 0.3, carbsG: 11.6, fatG: 0.2 },
  catalogRef: { provider: "ciqual", id: "13039", version: "2025" },
};

const ref = { provider: "ciqual" as const, id: "13039", version: "2025" };

const catalog = { kind: "catalog" as const, ref, quantity: { amount: 100, unit: "g" as const } };

const typed = { name: "Oats", quantity: { amount: 80, unit: "g" as const }, nutrients: draftOats.nutrients };

void test("each source becomes the item the server resolves", () => {
  const rows = [
    draftRow({ kind: "saved", id: "s1" }, draftOats, 60),
    draftRow({ kind: "entry", entryId: "e1" }, draftOats),
    draftRow({ kind: "submitted", food: catalog }, apple, 150),
    draftRow({ kind: "submitted", food: typed }, draftOats, 40),
  ];

  assert.deepEqual(draftItems(rows), [
    { id: "s1", amount: 60 },
    { entryId: "e1", amount: 80 },
    // A Ciqual food stays a reference at the new amount, for the server to measure.
    { food: { kind: "catalog", ref, quantity: { amount: 150, unit: "g" } } },
    // A typed food carries its own nutrients, scaled to the amount, and no null reference.
    { food: { name: "Oats", quantity: { amount: 40, unit: "g" }, nutrients: { kcal: 150, proteinG: 5, carbsG: 25, fatG: 2.5 } } },
  ]);
});

void test("a half-typed amount holds the save back", () => {
  assert.equal(draftItems([{ ...draftRow({ kind: "submitted", food: typed }, draftOats), amount: "" }]), null);
});

void test("totals scale each food to its typed amount and stay unknown when one food lacks a value", () => {
  const rows = [draftRow({ kind: "submitted", food: typed }, draftOats, 40), draftRow({ kind: "submitted", food: catalog }, apple, 150)];

  assert.deepEqual(totalNutrients(rows.map((row) => rowFood(row).nutrients)), { kcal: 228, proteinG: 5.45, carbsG: 42.4, fatG: 2.8 });
  assert.equal(totalNutrients([...rows, draftRow({ kind: "submitted", food: typed }, { ...draftOats, nutrients: { ...draftOats.nutrients, kcal: null } })].map((row) => rowFood(row).nutrients)).kcal, null);
  assert.equal(totalNutrients([]).kcal, null);
});
