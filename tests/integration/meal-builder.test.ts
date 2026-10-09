import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { MealInput } from "../../src/meals/contract.js";
import { localDate } from "../../src/time.js";

const { app, headers, setup, cleanup } = createHarness();

const timeZone = "Europe/Lisbon";

function create(key: string, body: MealInput) {
  return app.request("/v1/saved-meals", { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

// A body without `daily` checks that leaving it out is refused.
function edit(id: string, key: string, revision: number, body: MealInput | Omit<MealInput, "daily">) {
  return app.request(`/v1/saved-meals/${id}`, { method: "PATCH", headers: { ...headers, "Idempotency-Key": key, "If-Match": `"${revision}"` }, body: JSON.stringify(body) });
}

const skyr = { name: "Skyr", quantity: { amount: 170, unit: "g" as const }, nutrients: { kcal: 110, proteinG: 18, carbsG: 7, fatG: 0.3 } };

void test("a meal is built from Ciqual and typed foods without logging them first", async () => {
  await setup();

  try {
    const search = await (await app.request("/v1/foods/search?q=apple&locale=en", { headers })).json();
    const apple = search.items[0];

    // Ciqual foods are resolved on the server; a typed food keeps its own label; daily applies on create.
    const created = await create("meal-1", { name: "Breakfast", items: [{ food: skyr }, { food: { kind: "catalog", ref: apple.ref, quantity: { amount: 150, unit: "g" } } }], daily: { time: "08:00", timeZone } });
    assert.equal(created.status, 201);
    const meal = await created.json();

    assert.deepEqual(meal.items.map((item: { food: { name: string } }) => item.food.name), ["Skyr", apple.name]);
    assert.deepEqual(meal.items[0].food, { ...skyr, catalogRef: null });
    assert.deepEqual(meal.items[1].food.quantity, { amount: 150, unit: "g" });
    assert.equal(meal.items[1].food.nutrients.kcal, Math.round(apple.nutrients.kcal * 1.5 * 1000) / 1000);
    assert.deepEqual(meal.items[1].food.catalogRef, apple.ref);
    assert.deepEqual(meal.daily, { time: "08:00", timeZone });

    // Nothing was logged by building it, apart from today's daily fill.
    const today = localDate(new Date().toISOString(), timeZone);
    const day = await (await app.request(`/v1/days/${today}`, { headers })).json();
    assert.equal(day.food.entryCount, 2);

    // An edit keeps saved items by id, adds new ones, drops the rest, and can turn daily off.
    const [skyrItem, appleItem] = meal.items;
    const edited = await edit(meal.id, "edit-1", 1, { name: "Light breakfast", items: [{ id: appleItem.id, amount: 100 }, { food: { kind: "catalog", ref: apple.ref, quantity: { amount: 50, unit: "g" } } }], daily: null });
    assert.equal(edited.status, 200);
    const next = await edited.json();

    assert.equal(next.revision, 2);
    assert.equal(next.items[0].id, appleItem.id);
    assert.deepEqual(next.items[0].food.quantity, { amount: 100, unit: "g" });
    assert.notEqual(next.items[1].id, appleItem.id);
    assert.ok(next.items.every((item: { id: string }) => item.id !== skyrItem.id));
    assert.equal(next.daily, null);

    // A typed food cannot claim Ciqual nutrients, and an unknown Ciqual food is not found.
    assert.equal((await create("forged", { name: "Forged", items: [{ food: { ...skyr, catalogRef: apple.ref } }], daily: null })).status, 400);
    assert.equal((await create("unknown", { name: "Unknown", items: [{ food: { kind: "catalog", ref: { ...apple.ref, id: "does-not-exist" }, quantity: { amount: 100, unit: "g" } } }], daily: null })).status, 404);
    // An edit replaces the meal, so leaving out the daily setting is refused rather than read as off.
    assert.equal((await edit(meal.id, "no-daily", next.revision, { name: "No daily", items: [{ food: skyr }] })).status, 400);
    assert.equal((await create("unknown", { name: "Unknown", items: [{ food: skyr }], daily: null })).status, 201);
  } finally {
    await cleanup();
  }
});
