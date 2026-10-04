import assert from "node:assert/strict";
import { test } from "node:test";
import { isBarcode, scaleFood } from "../../src/food/contract.js";
import { openFoodFacts } from "../../src/food/packaged.js";
import { FakeOpenFoodFacts } from "../fake-open-food-facts.js";

void test("a barcode needs a valid GS1 check digit", () => {
  for (const code of ["3017620422003", "5449000000996", "049000028911", "96385074", "10012345678902"]) assert.ok(isBarcode(code), code);

  for (const code of ["3017620422004", "301762042200", "1234567", "abcdefghijklm", "", "301762042200 3"]) assert.ok(!isBarcode(code), code);
});

void test("a product carries its label per 100 g, its serving, and its first brand", async () => {
  const fake = new FakeOpenFoodFacts();
  const found = await openFoodFacts(fake.fetch).lookup("3017620422003");

  assert.equal(found.outcome, "found");
  assert.ok(found.outcome === "found");
  assert.deepEqual(found.result.product, {
    barcode: "3017620422003",
    brand: "Nutella",
    food: {
      name: "Nutella",
      quantity: { amount: 100, unit: "g" },
      nutrients: { kcal: 539, proteinG: 6.3, carbsG: 57.5, fatG: 30.9 },
      catalogRef: { provider: "open-food-facts", id: "3017620422003", version: "1791077660" },
    },
    serving: null,
  });
  assert.equal(found.result.attribution[0]?.url, "https://world.openfoodfacts.org/product/3017620422003");

  const request = fake.requests[0];

  assert.ok(request);
  assert.match(request.headers.get("User-Agent") ?? "", /^Nouri\//);
  assert.equal(new URL(request.url).pathname, "/api/v2/product/3017620422003.json");
});

void test("a drink is measured in millilitres and scales like any recorded food", async () => {
  const found = await openFoodFacts(new FakeOpenFoodFacts().fetch).lookup("5449000000996");

  assert.ok(found.outcome === "found");
  const { food, serving } = found.result.product;

  assert.deepEqual(food.quantity, { amount: 100, unit: "ml" });
  assert.deepEqual(serving, { amount: 330, unit: "ml" });
  assert.deepEqual(scaleFood(food, 330).nutrients, { kcal: 139.92, proteinG: 0, carbsG: 34.98, fatG: 0 });
});

void test("missing, impossible, and kJ-only values map to what the label supports", async () => {
  const fake = new FakeOpenFoodFacts();

  fake.products.set("96385074", JSON.stringify({
    status: 1,
    product: {
      product_name: " Granola ",
      brands: "",
      product_quantity_unit: "g",
      serving_quantity: "45",
      serving_quantity_unit: "ml",
      nutriments: { "energy-kj_100g": "1900", proteins_100g: -1, carbohydrates_100g: 140, fat_100g: "n/a" },
    },
  }));
  const found = await openFoodFacts(fake.fetch).lookup("96385074");

  assert.ok(found.outcome === "found");
  assert.equal(found.result.product.food.name, "Granola");
  assert.equal(found.result.product.brand, null);
  // A serving in the other unit would need a density, so it is dropped.
  assert.equal(found.result.product.serving, null);
  assert.deepEqual(found.result.product.food.nutrients, { kcal: 454.111, proteinG: null, carbsG: null, fatG: null });
  assert.equal(found.result.product.food.catalogRef?.version, undefined);
});

void test("an unknown, unnamed, or unreadable product is not found, and an outage is unavailable", async () => {
  const fake = new FakeOpenFoodFacts();
  const lookup = openFoodFacts(fake.fetch).lookup;

  assert.deepEqual(await lookup("96385074"), { outcome: "not-found" });

  fake.products.set("96385074", JSON.stringify({ status: 1, product: { product_name: "", nutriments: {} } }));
  assert.deepEqual(await lookup("96385074"), { outcome: "not-found" });

  fake.products.set("96385074", JSON.stringify({ status: 0, status_verbose: "product not found" }));
  assert.deepEqual(await lookup("96385074"), { outcome: "not-found" });

  fake.products.set("96385074", "<html>maintenance</html>");
  assert.deepEqual(await lookup("96385074"), { outcome: "unavailable" });

  fake.down = true;
  assert.deepEqual(await lookup("3017620422003"), { outcome: "unavailable" });
});
