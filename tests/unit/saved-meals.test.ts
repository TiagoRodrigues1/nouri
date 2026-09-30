import assert from "node:assert/strict";
import { test } from "node:test";
import { chosenAmounts, includedKcal, mealRows, rowFood } from "../../frontend/src/lib/saved-meals.js";
import { scaleFood, type MealFood } from "../../src/meals/contract.js";

const oats: MealFood = { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 0.001 }, catalogRef: null };

const yogurt: MealFood = {
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

void test("rows send only included foods, at their typed amounts", () => {
  const rows = mealRows(items, (id) => id === "a");

  assert.deepEqual(chosenAmounts(rows), [{ id: "a", amount: 80 }]);
  assert.deepEqual(chosenAmounts([{ ...rows[0]!, amount: "45.5" }, rows[1]!]), [{ id: "a", amount: 45.5 }]);
  assert.equal(chosenAmounts([{ ...rows[0]!, amount: "" }, rows[1]!]), null);
  assert.equal(chosenAmounts([{ ...rows[0]!, amount: "0" }, rows[1]!]), null);
  assert.deepEqual(chosenAmounts([{ ...rows[0]!, included: false, amount: "" }, rows[1]!]), []);
});

void test("the preview scales each food and totals only what is included", () => {
  const rows = mealRows(items);

  assert.equal(includedKcal(rows), 390);
  assert.equal(includedKcal([rows[0]!, { ...rows[1]!, amount: "2" }]), 480);
  assert.equal(includedKcal([{ ...rows[0]!, included: false }, { ...rows[1]!, included: false }]), null);
  assert.equal(includedKcal([rows[0]!, { ...rows[1]!, food: { ...yogurt, nutrients: { ...yogurt.nutrients, kcal: null } } }]), null);
  // A half-typed amount previews the saved amount rather than zero.
  assert.equal(rowFood({ ...rows[0]!, amount: "" }).nutrients.kcal, 300);
});
