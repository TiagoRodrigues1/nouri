import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoodBatchInput, FoodSubmission } from "../../src/food/contract.js";

const { app, otherApp, headers, setup, cleanup } = createHarness();

const when = { occurredAt: "2026-09-25T07:30:00Z", timeZone: "Europe/Lisbon" };

function post(target: typeof app, path: string, key: string, body: FoodSubmission | FoodBatchInput) {
  return target.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

async function day(date: string) {
  return (await (await app.request(`/v1/days/${date}`, { headers })).json()).food;
}

void test("a batch logs recent and searched foods at one time, all or none", async () => {
  await setup();

  try {
    const search = await (await app.request("/v1/foods/search?q=apple&locale=en", { headers })).json();

    const oats = await (await post(app, "/v1/food-entries", "oats", {
      ...when, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 5 } },
    })).json();

    // Recent foods scale from their entry; a Ciqual food is measured here; a typed food logs as sent. Order is kept.
    const batch: FoodBatchInput = {
      occurredAt: "2026-09-26T08:00:00Z",
      timeZone: "Europe/Lisbon",
      items: [
        { entryId: oats.id, amount: 60 },
        { food: { kind: "catalog", ref: search.items[0].ref, quantity: { amount: 100, unit: "g" } } },
        { food: { name: "Tea", quantity: { amount: 250, unit: "ml" }, nutrients: { kcal: 2, proteinG: 0, carbsG: 0, fatG: 0 } } },
      ],
    };

    const [logged, again] = await Promise.all([post(app, "/v1/food-entries/batches", "batch-1", batch), post(app, "/v1/food-entries/batches", "batch-1", batch)]);
    assert.equal(logged.status, 201);
    const { entries } = await logged.json();
    assert.deepEqual((await again.json()).entries, entries);
    assert.deepEqual(entries.map((entry: { food: { name: string } }) => entry.food.name), ["Oats", "Apple, flesh and skin, raw", "Tea"]);
    assert.deepEqual(entries[0].food.nutrients, { kcal: 225, proteinG: 7.5, carbsG: null, fatG: 3.75 });
    assert.equal(entries[1].food.catalogRef.provider, "ciqual");
    assert.ok(entries.every((entry: { occurredAt: string; localDate: string }) => entry.occurredAt === "2026-09-26T08:00:00.000Z" && entry.localDate === "2026-09-26"));
    assert.equal((await day("2026-09-26")).entryCount, 3);
    assert.equal((await post(app, "/v1/food-entries/batches", "batch-1", { ...batch, items: batch.items.slice(1) })).status, 409);

    // A failing item logs nothing. An amount past the journal's limits or an unknown catalog food keeps no receipt.
    const salt = await (await post(app, "/v1/food-entries", "salt", {
      ...when, food: { name: "Salt", quantity: { amount: 0.001, unit: "g" }, nutrients: { kcal: 1, proteinG: null, carbsG: null, fatG: null } },
    })).json();

    const tooMuch = await post(app, "/v1/food-entries/batches", "batch-2", { ...batch, items: [batch.items[2]!, { entryId: salt.id, amount: 10_000 }] });
    assert.equal(tooMuch.status, 400);
    const unknown = await post(app, "/v1/food-entries/batches", "batch-3", { ...batch, items: [batch.items[2]!, { food: { kind: "catalog", ref: { ...search.items[0].ref, id: "999999999" }, quantity: { amount: 100, unit: "g" } } }] });
    assert.equal(unknown.status, 404);
    assert.equal((await post(otherApp, "/v1/food-entries/batches", "batch-4", batch)).status, 404);
    assert.equal((await day("2026-09-26")).entryCount, 3);
    assert.equal((await post(app, "/v1/food-entries/batches", "batch-2", { ...batch, items: [{ entryId: oats.id, amount: 100 }] })).status, 201);

    assert.equal((await post(app, "/v1/food-entries/batches", "batch-empty", { ...batch, items: [] })).status, 400);
    assert.equal((await post(app, "/v1/food-entries/batches", "batch-big", { ...batch, items: Array.from({ length: 21 }, () => batch.items[2]!) })).status, 400);
  } finally {
    await cleanup();
  }
});
