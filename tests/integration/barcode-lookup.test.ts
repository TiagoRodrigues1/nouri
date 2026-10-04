import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { manualFood, scaleFood, type BarcodeLookup } from "../../src/food/contract.js";

const { app, headers, products, setup, cleanup } = createHarness();

before(setup);

after(cleanup);

function lookup(code: string) {
  return app.request(`/v1/foods/barcodes/${code}`, { headers });
}

void test("a barcode finds a packaged food that logs and repeats as a recorded food", async () => {
  const response = await lookup("5449000000996");
  assert.equal(response.status, 200);
  const { product, attribution }: BarcodeLookup = await response.json();
  assert.equal(product.food.name, "Coca-Cola Original");
  assert.equal(product.brand, "COCA-COLA SERVICES SA/NV");
  assert.deepEqual(product.serving, { amount: 330, unit: "ml" });
  assert.deepEqual(attribution.map((source) => source.provider), ["open-food-facts"]);

  // The page scales the per-100 food to the amount and logs it with its reference.
  const body = { occurredAt: "2026-09-26T12:00:00Z", timeZone: "Europe/Lisbon", food: manualFood(scaleFood(product.food, 330)) };
  const created = await app.request("/v1/food-entries", { method: "POST", headers: { ...headers, "Idempotency-Key": "coke-1" }, body: JSON.stringify(body) });
  assert.equal(created.status, 201);
  const entry = await created.json();
  assert.deepEqual(entry.food, {
    name: "Coca-Cola Original",
    quantity: { amount: 330, unit: "ml" },
    nutrients: { kcal: 139.92, proteinG: 0, carbsG: 34.98, fatG: 0 },
    catalogRef: { provider: "open-food-facts", id: "5449000000996", version: "1790987612" },
  });

  // Logging again copies the snapshot without asking Open Food Facts.
  const requestsBefore = products.requests.length;
  const repeated = await app.request(`/v1/food-entries/${entry.id}/repeats`, { method: "POST", headers: { ...headers, "Idempotency-Key": "coke-2" }, body: JSON.stringify({ occurredAt: "2026-09-27T12:00:00Z", timeZone: "Europe/Lisbon", amount: 165 }) });
  assert.equal(repeated.status, 201);
  assert.deepEqual((await repeated.json()).food.nutrients, { kcal: 69.96, proteinG: 0, carbsG: 17.49, fatG: 0 });
  assert.equal(products.requests.length, requestsBefore);

  // The day's totals include the product.
  assert.equal((await (await app.request("/v1/days/2026-09-26", { headers })).json()).food.totals.kcal, 139.92);
});

void test("a lookup rejects a bad barcode before asking, and reports missing products and outages", async () => {
  const requestsBefore = products.requests.length;

  for (const code of ["3017620422004", "12345", "abcdefgh"]) assert.equal((await lookup(code)).status, 400, code);
  assert.equal(products.requests.length, requestsBefore);

  const missing = await lookup("96385074");
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: "No product found for this barcode" });

  products.down = true;

  try {
    const down = await lookup("3017620422003");
    assert.equal(down.status, 502);
    assert.match((await down.json()).error, /add the food manually/);
  } finally {
    products.down = false;
  }

  assert.equal((await app.request("/v1/foods/barcodes/3017620422003")).status, 401);
});
