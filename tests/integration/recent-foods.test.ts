import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoodSubmission, RepeatInput } from "../../src/food/contract.js";

const { app, otherApp, headers, setup, cleanup } = createHarness();

function post(path: string, key: string, body: FoodSubmission | RepeatInput) {
  return app.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

function manual(occurredAt: string, name: string, amount: number, kcal: number): FoodSubmission {
  return { occurredAt, timeZone: "Europe/Lisbon", food: { name, quantity: { amount, unit: "g" }, nutrients: { kcal, proteinG: 10, carbsG: null, fatG: 5 } } };
}

async function recent(target = app) {
  return (await (await target.request("/v1/foods/recent", { headers })).json()).foods;
}

void test("recent foods list each food once and log again at a chosen amount", async () => {
  await setup();

  try {
    assert.deepEqual(await recent(), []);

    const oats = await (await post("/v1/food-entries", "oats-1", manual("2026-09-24T07:00:00Z", "Oats", 80, 300))).json();
    const later = await (await post("/v1/food-entries", "oats-2", manual("2026-09-25T07:00:00Z", " oats ", 60, 225))).json();
    const banana = await (await post("/v1/food-entries", "banana", manual("2026-09-25T10:00:00Z", "Banana", 120, 107))).json();
    // Logged later but eaten earlier, so it ranks by when it was eaten.
    const rice = await (await post("/v1/food-entries", "rice", manual("2026-09-20T12:00:00Z", "Rice", 150, 195))).json();

    // The same name in any case or spacing is one food, shown from its latest entry.
    const foods = await recent();
    assert.deepEqual(foods.map((food: { entryId: string }) => food.entryId), [banana.id, later.id, rice.id]);
    assert.deepEqual(foods[1], { entryId: later.id, lastEaten: "2026-09-25", food: later.food });
    assert.deepEqual(await recent(otherApp), []);

    // An amount scales the recorded food; an unknown nutrient stays unknown.
    const body: RepeatInput = { occurredAt: "2026-09-26T08:00:00Z", timeZone: "Europe/Lisbon", amount: 90 };
    const repeated = await post(`/v1/food-entries/${oats.id}/repeats`, "repeat-90", body);
    assert.equal(repeated.status, 201);
    const entry = await repeated.json();
    assert.equal(entry.localDate, "2026-09-26");
    assert.deepEqual(entry.food, { name: "Oats", quantity: { amount: 90, unit: "g" }, nutrients: { kcal: 337.5, proteinG: 11.25, carbsG: null, fatG: 5.625 }, catalogRef: null });
    assert.deepEqual(await (await post(`/v1/food-entries/${oats.id}/repeats`, "repeat-90", body)).json(), entry);
    assert.equal((await post(`/v1/food-entries/${oats.id}/repeats`, "repeat-90", { ...body, amount: 91 })).status, 409);
    assert.equal((await recent())[0].entryId, entry.id);

    // An amount whose nutrients exceed the journal's limits keeps no receipt, so the key can be fixed and sent again.
    const tiny = await (await post("/v1/food-entries", "tiny", manual("2026-09-26T09:00:00Z", "Salt", 0.001, 1))).json();
    const tooMuch = await post(`/v1/food-entries/${tiny.id}/repeats`, "repeat-huge", { ...body, amount: 10_000 });
    assert.equal(tooMuch.status, 400);
    assert.equal((await post(`/v1/food-entries/${tiny.id}/repeats`, "repeat-huge", { ...body, amount: 1 })).status, 201);
    assert.equal((await post(`/v1/food-entries/${tiny.id}/repeats`, "repeat-zero", { ...body, amount: 0 })).status, 400);
    assert.equal((await post(`/v1/food-entries/${tiny.id}/repeats`, "repeat-over", { ...body, amount: 10_001 })).status, 400);

    // A deleted entry no longer stands for its food.
    assert.equal((await app.request(`/v1/food-entries/${banana.id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": "banana-delete", "If-Match": '"1"' } })).status, 204);
    assert.ok(!(await recent()).some((food: { food: { name: string } }) => food.food.name === "Banana"));

    // Foods eaten at the same time list the latest logged first.
    await post("/v1/food-entries", "tea", manual("2026-09-30T08:00:00Z", "Tea", 250, 2));
    await post("/v1/food-entries", "toast", manual("2026-09-30T08:00:00Z", "Toast", 40, 110));
    assert.deepEqual((await recent()).slice(0, 2).map((food: { food: { name: string } }) => food.food.name), ["Toast", "Tea"]);
  } finally {
    await cleanup();
  }
});
