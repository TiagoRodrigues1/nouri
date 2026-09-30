import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoodSubmission } from "../../src/food/contract.js";
import type { MealInput, MealLogInput } from "../../src/meals/contract.js";

const { app, otherApp, headers, setup, cleanup } = createHarness();

const when = { occurredAt: "2026-09-25T07:30:00Z", timeZone: "Europe/Lisbon" };

function post(target: typeof app, path: string, key: string, body: FoodSubmission | MealInput | MealLogInput) {
  return target.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

function remove(id: string, key: string, revision: number) {
  return app.request(`/v1/saved-meals/${id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": key, "If-Match": `"${revision}"` } });
}

async function day(date: string) {
  return (await (await app.request(`/v1/days/${date}`, { headers })).json()).food;
}

void test("saved meals copy logged foods and log them again in one request", async () => {
  await setup();

  try {
    const search = await (await app.request("/v1/foods/search?q=apple&locale=en", { headers })).json();

    const apple = await (await post(app, "/v1/food-entries", "apple", {
      ...when, food: { kind: "catalog", ref: search.items[0].ref, quantity: { amount: 150, unit: "g" } },
    })).json();

    const oats = await (await post(app, "/v1/food-entries", "oats", {
      ...when, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 5 } },
    })).json();

    assert.deepEqual(await (await app.request("/v1/saved-meals", { headers })).json(), { meals: [] });

    // Saving copies each food at the chosen amount; an unknown nutrient stays unknown.
    const body = { name: "Usual breakfast", items: [{ entryId: oats.id, amount: 60 }, { entryId: apple.id, amount: 150 }] };
    const [saved, simultaneous] = await Promise.all([post(app, "/v1/saved-meals", "meal-1", body), post(app, "/v1/saved-meals", "meal-1", body)]);
    assert.equal(saved.status, 201);
    const meal = await saved.json();
    assert.deepEqual(await simultaneous.json(), meal);
    assert.equal(meal.name, "Usual breakfast");
    assert.deepEqual(meal.items.map((item: { food: { name: string } }) => item.food.name), ["Oats", "Apple, flesh and skin, raw"]);
    assert.deepEqual(meal.items[0].food.quantity, { amount: 60, unit: "g" });
    assert.deepEqual(meal.items[0].food.nutrients, { kcal: 225, proteinG: 7.5, carbsG: null, fatG: 3.75 });
    assert.deepEqual(meal.items[1].food, apple.food);
    assert.equal((await post(app, "/v1/saved-meals", "meal-1", { ...body, name: "Other" })).status, 409);

    // Editing or deleting the day it came from never changes the meal.
    assert.equal((await app.request(`/v1/food-entries/${oats.id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": "oats-delete", "If-Match": '"1"' } })).status, 204);
    assert.deepEqual((await (await app.request("/v1/saved-meals", { headers })).json()).meals, [meal]);
    assert.equal((await post(app, "/v1/saved-meals", "meal-gone", { name: "Gone", items: [{ entryId: oats.id, amount: 60 }] })).status, 404);
    assert.equal((await post(app, "/v1/saved-meals", "meal-foreign", { name: "Foreign", items: [{ entryId: apple.id, amount: 1 }] })).status, 201);
    assert.equal((await post(otherApp, "/v1/saved-meals", "meal-foreign", { name: "Foreign", items: [{ entryId: apple.id, amount: 1 }] })).status, 404);
    assert.equal((await post(app, "/v1/saved-meals", "meal-empty", { name: "Empty", items: [] })).status, 400);
    assert.equal((await post(app, "/v1/saved-meals", "meal-twice", { name: "Twice", items: [{ entryId: apple.id, amount: 1 }, { entryId: apple.id, amount: 2 }] })).status, 400);

    // Logging writes the chosen items at one time, in the meal's order, scaled to today's amounts.
    const [oatsItem, appleItem] = meal.items;
    const log = { occurredAt: "2026-09-26T07:00:00Z", timeZone: "Europe/Lisbon", items: [{ id: appleItem.id, amount: 100 }, { id: oatsItem.id, amount: 90 }] };
    const [logged, again] = await Promise.all([post(app, `/v1/saved-meals/${meal.id}/logs`, "log-1", log), post(app, `/v1/saved-meals/${meal.id}/logs`, "log-1", log)]);
    assert.equal(logged.status, 201);
    const { entries } = await logged.json();
    assert.deepEqual((await again.json()).entries, entries);
    assert.deepEqual(entries.map((entry: { food: { name: string } }) => entry.food.name), ["Oats", "Apple, flesh and skin, raw"]);
    assert.deepEqual(entries[0].food.nutrients, { kcal: 337.5, proteinG: 11.25, carbsG: null, fatG: 5.625 });
    assert.deepEqual(entries[1].food.nutrients, { kcal: 54, proteinG: 0.25, carbsG: 11.6, fatG: 0.25 });
    assert.deepEqual(entries[1].food.catalogRef, apple.food.catalogRef);
    assert.ok(entries.every((entry: { occurredAt: string; localDate: string }) => entry.occurredAt === "2026-09-26T07:00:00.000Z" && entry.localDate === "2026-09-26"));
    const logDay = await day("2026-09-26");
    assert.equal(logDay.entryCount, 2);
    assert.equal(logDay.totals.carbsG, null);

    // An item left out is not logged; an item the meal lacks or an amount past the journal's limits logs nothing.
    const appleOnly = await post(app, `/v1/saved-meals/${meal.id}/logs`, "log-2", { ...log, items: [{ id: appleItem.id, amount: 150 }] });
    assert.equal(appleOnly.status, 201);
    assert.deepEqual((await appleOnly.json()).entries.map((entry: { food: { name: string } }) => entry.food.name), ["Apple, flesh and skin, raw"]);
    const unknown = { ...log, items: [{ id: appleItem.id, amount: 150 }, { id: crypto.randomUUID(), amount: 1 }] };
    assert.equal((await post(app, `/v1/saved-meals/${meal.id}/logs`, "log-3", unknown)).status, 400);
    assert.equal((await post(app, `/v1/saved-meals/${meal.id}/logs`, "log-3", log)).status, 201);
    assert.equal((await post(app, `/v1/saved-meals/${meal.id}/logs`, "log-4", { ...log, items: [] })).status, 400);
    assert.equal((await post(app, `/v1/saved-meals/${meal.id}/logs`, "log-5", { ...log, items: [{ id: appleItem.id, amount: 10_001 }] })).status, 400);
    assert.equal((await day("2026-09-26")).entryCount, 5);
    assert.equal((await post(otherApp, `/v1/saved-meals/${meal.id}/logs`, "log-6", log)).status, 404);

    // Deleting the meal keeps what was logged from it.
    assert.equal((await remove(meal.id, "meal-delete-stale", 2)).status, 409);
    assert.equal((await remove(meal.id, "meal-delete", 1)).status, 204);
    assert.equal((await remove(meal.id, "meal-delete", 1)).status, 204);
    assert.equal((await post(app, `/v1/saved-meals/${meal.id}/logs`, "log-7", log)).status, 404);
    assert.deepEqual((await (await app.request("/v1/saved-meals", { headers })).json()).meals.map((saved: { name: string }) => saved.name), ["Foreign"]);
    assert.equal((await day("2026-09-26")).entryCount, 5);
  } finally {
    await cleanup();
  }
});
