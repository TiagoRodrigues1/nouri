import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoodInput, FoodSubmission } from "../../src/food/contract.js";
import type { MealInput, MealLogInput } from "../../src/meals/contract.js";
import { localDate } from "../../src/time.js";

let { app, otherApp, headers, setup, cleanup } = createHarness();

const timeZone = "Europe/Lisbon";

const at = { occurredAt: "2026-09-26T07:00:00Z", timeZone };

type Meal = { id: string; revision: number; name: string; items: Array<{ id: string; food: { quantity: { amount: number } } }> };

type Entry = { id: string; mealLogId: string | null; food: { name: string } };

function post(target: typeof app, path: string, key: string, body: FoodSubmission | MealInput | MealLogInput) {
  return target.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

function undo(target: typeof app, id: string, key: string) {
  return target.request(`/v1/meal-logs/${id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": key } });
}

async function day(date: string): Promise<{ food: { entries: Entry[] }; mealLogs: Array<{ id: string; name: string }> }> {
  return (await app.request(`/v1/days/${date}`, { headers })).json();
}

async function listed(): Promise<Array<Meal & { lastLogged: string | null }>> {
  return (await (await app.request("/v1/saved-meals", { headers })).json()).meals;
}

async function names(): Promise<string[]> {
  return (await listed()).map((meal) => meal.name);
}

async function lastLogged(): Promise<Record<string, string | null>> {
  return Object.fromEntries((await listed()).map((meal) => [meal.name, meal.lastLogged]));
}

function food(name: string): FoodInput["food"] {
  return { name, quantity: { amount: 100, unit: "g" }, nutrients: { kcal: 100, proteinG: 1, carbsG: 1, fatG: 1 } };
}

async function saveMeal(name: string, foods: string[]): Promise<Meal> {
  return (await post(app, "/v1/saved-meals", `meal-${name}`, { name, items: foods.map((item) => ({ food: food(item) })), daily: null })).json();
}

async function logMeal(meal: Meal, key: string, when = at): Promise<Entry[]> {
  const response = await post(app, `/v1/saved-meals/${meal.id}/logs`, key, { ...when, items: meal.items.map((item) => ({ id: item.id, amount: item.food.quantity.amount })) });

  assert.equal(response.status, 201);

  return (await response.json()).entries;
}

void test("a logged meal is removed whole, edited foods included, and nothing else", async () => {
  await setup();

  try {
    const meal = await saveMeal("Breakfast", ["Oats", "Milk"]);
    const entries = await logMeal(meal, "log-1");
    const logId = entries[0]?.mealLogId;
    assert.ok(logId);
    assert.ok(entries.every((entry) => entry.mealLogId === logId));

    // Foods logged on their own belong to no meal.
    const apple = await (await post(app, "/v1/food-entries", "apple", { ...at, food: food("Apple") })).json();
    assert.equal(apple.mealLogId, null);

    // The day names the log, so the page can show the meal and remove it.
    assert.deepEqual((await day("2026-09-26")).mealLogs, [{ id: logId, name: "Breakfast" }]);

    // Renaming the meal later keeps the name it was logged under.
    await app.request(`/v1/saved-meals/${meal.id}`, {
      method: "PATCH", headers: { ...headers, "Idempotency-Key": "rename", "If-Match": `"${meal.revision}"` },
      body: JSON.stringify({ name: "Morning", items: meal.items.map((item) => ({ id: item.id, amount: item.food.quantity.amount })), daily: null }),
    });
    assert.deepEqual((await day("2026-09-26")).mealLogs, [{ id: logId, name: "Breakfast" }]);

    // An entry edited since still goes with its meal.
    const [oats] = entries;
    assert.ok(oats);

    const edited = await app.request(`/v1/food-entries/${oats.id}`, {
      method: "PATCH", headers: { ...headers, "Idempotency-Key": "edit-oats", "If-Match": '"1"' },
      body: JSON.stringify({ ...at, food: food("Porridge") }),
    });

    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).mealLogId, logId);

    assert.equal((await undo(otherApp, logId, "undo-1")).status, 404);
    assert.equal((await undo(app, logId, "undo-1")).status, 204);
    assert.equal((await undo(app, logId, "undo-1")).status, 204);
    assert.equal((await undo(app, logId, "undo-2")).status, 404);
    assert.equal((await undo(app, crypto.randomUUID(), "undo-3")).status, 404);

    const after = await day("2026-09-26");
    assert.deepEqual(after.food.entries.map((entry) => entry.food.name), ["Apple"]);
    assert.deepEqual(after.mealLogs, []);
  } finally {
    await cleanup();
  }
});

void test("meals are listed most recently logged first, and an undone log stops counting", async () => {
  ({ app, otherApp, headers, setup, cleanup } = createHarness());
  await setup();

  try {
    const lunch = await saveMeal("Lunch", ["Rice"]);
    await saveMeal("Dinner", ["Soup"]);

    // Never logged, a meal ranks by when it was saved.
    assert.deepEqual(await names(), ["Dinner", "Lunch"]);
    assert.deepEqual(await lastLogged(), { Dinner: null, Lunch: null });

    const [rice] = await logMeal(lunch, "lunch-1");
    assert.deepEqual(await names(), ["Lunch", "Dinner"]);

    // The last day is the day its foods are on, not the day it was logged.
    const [earlier] = await logMeal(lunch, "lunch-0", { occurredAt: "2026-09-20T12:00:00Z", timeZone });
    assert.deepEqual(await lastLogged(), { Lunch: "2026-09-26", Dinner: null });
    assert.ok(earlier?.mealLogId);
    assert.equal((await undo(app, earlier.mealLogId, "undo-earlier")).status, 204);

    // A meal saved after the last log is newer still.
    await saveMeal("Snack", ["Nuts"]);
    assert.deepEqual(await names(), ["Snack", "Lunch", "Dinner"]);

    assert.ok(rice?.mealLogId);
    assert.equal((await undo(app, rice.mealLogId, "undo-lunch")).status, 204);
    assert.deepEqual(await names(), ["Snack", "Dinner", "Lunch"]);
    assert.equal((await lastLogged()).Lunch, null);
  } finally {
    await cleanup();
  }
});

void test("each day a daily meal fills is a log of its own that never ranks the meal", async () => {
  ({ app, otherApp, headers, setup, cleanup } = createHarness());
  await setup();

  try {
    const breakfast = await saveMeal("Breakfast", ["Oats"]);
    await saveMeal("Dinner", ["Soup"]);

    const daily = await app.request(`/v1/saved-meals/${breakfast.id}`, {
      method: "PATCH", headers: { ...headers, "Idempotency-Key": "daily", "If-Match": `"${breakfast.revision}"` },
      body: JSON.stringify({ name: "Breakfast", items: breakfast.items.map((item) => ({ id: item.id, amount: item.food.quantity.amount })), daily: { time: "08:00", timeZone } }),
    });

    assert.equal(daily.status, 200);

    // Listing meals fills today first, so a fill counts as the last day the meal is on.
    const today = localDate(new Date().toISOString(), timeZone);
    assert.equal((await lastLogged()).Breakfast, today);
    const filled = await day(today);
    assert.equal(filled.food.entries.length, 1);
    assert.deepEqual(filled.mealLogs.map((log) => log.name), ["Breakfast"]);
    assert.deepEqual(await names(), ["Dinner", "Breakfast"]);

    // Skipped today: the fill is removed whole and is not filled again.
    const [log] = filled.mealLogs;
    assert.ok(log);
    assert.equal((await undo(app, log.id, "skip")).status, 204);
    assert.deepEqual((await day(today)).food.entries, []);
    assert.equal((await lastLogged()).Breakfast, null);
  } finally {
    await cleanup();
  }
});
