import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoodSubmission } from "../../src/food/contract.js";
import type { MealInput, MealLogInput } from "../../src/meals/contract.js";

const { app, otherApp, headers, setup, cleanup } = createHarness();

const when = { occurredAt: "2026-09-25T07:30:00Z", timeZone: "Europe/Lisbon" };

function post(path: string, key: string, body: FoodSubmission | MealInput | MealLogInput) {
  return app.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

function edit(target: typeof app, id: string, key: string, revision: number, body: MealInput) {
  return target.request(`/v1/saved-meals/${id}`, { method: "PATCH", headers: { ...headers, "Idempotency-Key": key, "If-Match": `"${revision}"` }, body: JSON.stringify(body) });
}

void test("editing a saved meal renames it and re-amounts or removes items without drifting", async () => {
  await setup();

  try {
    const oats = await (await post("/v1/food-entries", "oats", {
      ...when, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 0.001 } },
    })).json();

    const milk = await (await post("/v1/food-entries", "milk", {
      ...when, food: { name: "Milk", quantity: { amount: 200, unit: "ml" }, nutrients: { kcal: 90, proteinG: 7, carbsG: 10, fatG: 3 } },
    })).json();

    const meal = await (await post("/v1/saved-meals", "meal", { name: "Breakfast", items: [{ entryId: oats.id, amount: 80 }, { entryId: milk.id, amount: 200 }], daily: null })).json();
    const [oatsItem, milkItem] = meal.items;

    // A tiny amount rounds the fat to 0, yet the next edit scales from the recorded food, not from that.
    const tiny = { name: "Breakfast", items: [{ id: oatsItem.id, amount: 10 }, { id: milkItem.id, amount: 200 }], daily: null };
    const [shrunk, again] = await Promise.all([edit(app, meal.id, "edit-1", 1, tiny), edit(app, meal.id, "edit-1", 1, tiny)]);
    assert.equal(shrunk.status, 200);
    const small = await shrunk.json();
    assert.deepEqual(await again.json(), small);
    assert.equal(small.revision, 2);
    assert.equal(small.items[0].food.nutrients.fatG, 0);
    assert.equal((await edit(app, meal.id, "edit-1", 1, { ...tiny, name: "Other" })).status, 409);

    // Renaming, re-amounting, and dropping an item keeps the kept item's id.
    const renamed = await edit(app, meal.id, "edit-2", 2, { name: " Light breakfast ", items: [{ id: oatsItem.id, amount: 80 }], daily: null });
    assert.equal(renamed.status, 200);
    const light = await renamed.json();
    assert.equal(light.name, "Light breakfast");
    assert.equal(light.revision, 3);
    assert.deepEqual(light.items, [{ id: oatsItem.id, food: oats.food }]);
    assert.deepEqual((await (await app.request("/v1/saved-meals", { headers })).json()).meals, [{ ...light, lastLogged: null }]);

    // A stale revision, an item the meal lacks, no items, or an amount past the limits changes nothing.
    // An invalid item keeps no receipt, so the key works once the request is fixed.
    assert.equal((await edit(app, meal.id, "edit-stale", 2, { name: "Stale", items: [{ id: oatsItem.id, amount: 1 }], daily: null })).status, 409);
    assert.equal((await edit(app, meal.id, "edit-removed", 3, { name: "Back", items: [{ id: milkItem.id, amount: 200 }], daily: null })).status, 400);
    assert.equal((await edit(app, meal.id, "edit-removed", 3, { name: "Back", items: [{ id: oatsItem.id, amount: 40 }], daily: null })).status, 200);
    assert.equal((await edit(app, meal.id, "edit-empty", 4, { name: "Empty", items: [], daily: null })).status, 400);
    assert.equal((await edit(app, meal.id, "edit-blank", 4, { name: " ", items: [{ id: oatsItem.id, amount: 1 }], daily: null })).status, 400);
    assert.equal((await edit(app, meal.id, "edit-huge", 4, { name: "Huge", items: [{ id: oatsItem.id, amount: 10_001 }], daily: null })).status, 400);
    assert.equal((await edit(otherApp, meal.id, "edit-foreign", 4, { name: "Foreign", items: [{ id: oatsItem.id, amount: 1 }], daily: null })).status, 404);
    assert.equal((await edit(app, crypto.randomUUID(), "edit-unknown", 1, { name: "Unknown", items: [{ id: oatsItem.id, amount: 1 }], daily: null })).status, 404);

    // Logging uses the kept items at their own amounts; the removed one is an item the meal lacks.
    const log = { occurredAt: "2026-09-26T07:00:00Z", timeZone: "Europe/Lisbon" };
    assert.equal((await post(`/v1/saved-meals/${meal.id}/logs`, "log-removed", { ...log, items: [{ id: milkItem.id, amount: 200 }] })).status, 400);
    const logged = await post(`/v1/saved-meals/${meal.id}/logs`, "log", { ...log, items: [{ id: oatsItem.id, amount: 80 }] });
    assert.equal(logged.status, 201);
    assert.deepEqual((await logged.json()).entries[0].food, oats.food);

    // A deleted meal cannot be edited.
    const remove = { method: "DELETE", headers: { ...headers, "Idempotency-Key": "meal-delete", "If-Match": '"4"' } };
    assert.equal((await app.request(`/v1/saved-meals/${meal.id}`, remove)).status, 204);
    assert.equal((await edit(app, meal.id, "edit-deleted", 5, { name: "Gone", items: [{ id: oatsItem.id, amount: 1 }], daily: null })).status, 404);
  } finally {
    await cleanup();
  }
});
