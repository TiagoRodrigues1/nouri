import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { approveFood, pendingFoods, rejectFood } from "../../src/food/community.js";
import { labelFoodSchema, manualFood, scaleFood, type BarcodeLookup, type CommunityFoodInput, type LabelFood, type SearchResult } from "../../src/food/contract.js";

const { app, otherApp, client, db, headers, products, signedInAs, setup, cleanup } = createHarness();

before(setup);

after(cleanup);

// A barcode Open Food Facts does not know, with a valid check digit.
const barcode = "5601234567892";

const label = {
  name: "Bolo de arroz",
  brand: "Pastelaria Aurora",
  barcode,
  unit: "g",
  nutrientsPer100: { kcal: 410, proteinG: 6, carbsG: 55, fatG: 18 },
  serving: { amount: 80 },
};

// A label as sent, which may carry a unit or a field the contract refuses.
type SentLabel = Omit<CommunityFoodInput, "unit"> & { unit: string; extra?: boolean };

function add(target: typeof app, key: string, body: SentLabel) {
  return target.request("/v1/foods", { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

function lookup(target: typeof app, code: string) {
  return target.request(`/v1/foods/barcodes/${code}`, { headers });
}

// The id of the food a successful add answers with.
async function addedId(response: Response): Promise<string> {
  const ref = labelFoodSchema.parse(await response.json()).food.catalogRef;

  assert.ok(ref);

  return ref.id;
}

async function search(target: typeof app, query: string): Promise<SearchResult["items"]> {
  const response = await target.request(`/v1/foods/search?q=${encodeURIComponent(query)}&locale=en`, { headers });

  assert.equal(response.status, 200);

  return (await response.json()).items;
}

void test("a food added from a label is found by its author at once, and by everyone once reviewed", async () => {
  assert.equal((await lookup(app, barcode)).status, 404);

  const created = await add(app, "bolo-1", label);
  assert.equal(created.status, 201);
  const food: LabelFood = await created.json();
  const ref = food.food.catalogRef;
  assert.equal(ref?.provider, "nouri");
  assert.deepEqual({ ...food, food: { ...food.food, catalogRef: null } }, {
    barcode,
    brand: "Pastelaria Aurora",
    food: { name: "Bolo de arroz", quantity: { amount: 100, unit: "g" }, nutrients: { kcal: 410, proteinG: 6, carbsG: 55, fatG: 18 }, catalogRef: null },
    serving: { amount: 80, unit: "g" },
  });

  // A retry with the same key answers with the same food instead of adding another.
  assert.deepEqual(await (await add(app, "bolo-1", label)).json(), food);

  // The author's scan finds it without asking Open Food Facts.
  const requestsBefore = products.requests.length;
  const found = await lookup(app, barcode);
  assert.equal(found.status, 200);
  const { product, attribution }: BarcodeLookup = await found.json();
  assert.deepEqual(product, food);
  assert.deepEqual(attribution, []);
  assert.equal(products.requests.length, requestsBefore);

  // Search shows it first, marked as a community food, ignoring accents and case.
  const [first] = await search(app, "BOLO árroz");
  assert.deepEqual(first, { kind: "community", ...food });

  // Nobody else sees it before review.
  assert.equal((await lookup(otherApp, barcode)).status, 404);
  assert.equal((await search(otherApp, "bolo arroz")).some((item) => item.kind === "community"), false);

  assert.equal(await approveFood(db, ref.id), "approved");
  assert.equal(await approveFood(db, ref.id), "missing");

  assert.deepEqual((await (await lookup(otherApp, barcode)).json()).product, food);
  assert.deepEqual((await search(otherApp, "aurora"))[0], { kind: "community", ...food });

  // Logging it is a manual food carrying the community reference.
  const body = { occurredAt: "2026-10-11T10:00:00Z", timeZone: "Europe/Lisbon", food: manualFood(scaleFood(food.food, 80)) };
  const logged = await otherApp.request("/v1/food-entries", { method: "POST", headers: { ...headers, "Idempotency-Key": "bolo-log" }, body: JSON.stringify(body) });
  assert.equal(logged.status, 201);
  assert.deepEqual((await logged.json()).food, {
    name: "Bolo de arroz",
    quantity: { amount: 80, unit: "g" },
    nutrients: { kcal: 328, proteinG: 4.8, carbsG: 44, fatG: 14.4 },
    catalogRef: ref,
  });

  // A reviewed barcode cannot be added again.
  const again = await add(otherApp, "bolo-other", label);
  assert.equal(again.status, 409);
  assert.deepEqual(await again.json(), { error: "A food with this barcode is already in Nouri" });
});

void test("labels outside what a label can carry are refused", async () => {
  const invalid = [
    { ...label, barcode: "5601234567893" },
    { ...label, nutrientsPer100: { ...label.nutrientsPer100, fatG: 101 } },
    { ...label, nutrientsPer100: { ...label.nutrientsPer100, kcal: 901 } },
    { ...label, unit: "serving" },
    { ...label, name: " " },
    { ...label, serving: { amount: 0 } },
    { ...label, barcode: null, extra: true },
  ];

  for (const [index, body] of invalid.entries()) assert.equal((await add(app, `invalid-${index}`, body)).status, 400, JSON.stringify(body));
});

void test("each person adds a barcode once, and only one submission of a barcode is approved", async () => {
  const code = "96385074";
  const first = await add(app, "pending-1", { ...label, name: "Queijada", barcode: code });
  assert.equal(first.status, 201);

  const repeat = await add(app, "pending-2", { ...label, name: "Queijada de Sintra", barcode: code });
  assert.equal(repeat.status, 409);
  assert.deepEqual(await repeat.json(), { error: "You already added this barcode" });

  // Another person may submit the same barcode while the first waits for review.
  const second = await add(otherApp, "pending-3", { ...label, name: "Queijadas", barcode: code });
  assert.equal(second.status, 201);
  const [firstId, secondId] = await Promise.all([addedId(first), addedId(second)]);

  assert.deepEqual((await pendingFoods(db)).map(({ food }) => food.name).filter((name) => name.startsWith("Queijada")), ["Queijada", "Queijadas"]);
  assert.equal(await approveFood(db, firstId), "approved");
  assert.equal(await approveFood(db, secondId), "conflict");

  // The second person now finds the reviewed food rather than their own.
  assert.equal((await (await lookup(otherApp, code)).json()).product.food.name, "Queijada");
  assert.equal(await rejectFood(db, secondId), true);
  assert.equal(await rejectFood(db, secondId), false);
});

void test("approving two submissions of a barcode at once approves one, and rejecting it lets the other through", async () => {
  const code = "4006381333931";
  const responses = await Promise.all([add(app, "race-1", { ...label, name: "Folar", barcode: code }), add(otherApp, "race-2", { ...label, name: "Folar de Olhão", barcode: code })]);
  const [first, second] = await Promise.all(responses.map(addedId));
  assert.ok(first !== undefined && second !== undefined);

  assert.deepEqual((await Promise.all([approveFood(db, first), approveFood(db, second)])).sort(), ["approved", "conflict"]);

  const approved = (await (await lookup(otherApp, code)).json()).product.food.catalogRef.id;
  const waiting = approved === first ? second : first;

  // Rejecting the reviewed food withdraws it from everyone, so the other submission can be approved.
  assert.equal(await rejectFood(db, approved), true);
  assert.equal(await approveFood(db, waiting), "approved");
});

void test("a community food answers a barcode Open Food Facts also knows, without asking it", async () => {
  const code = "5449000000996";
  const created = await add(app, "cola-1", { ...label, name: "Cola caseira", barcode: code, unit: "ml", nutrientsPer100: { kcal: 42, proteinG: 0, carbsG: 10.6, fatG: null } });
  assert.equal(created.status, 201);
  const food: LabelFood = await created.json();
  assert.equal(food.food.nutrients.fatG, null);

  const requestsBefore = products.requests.length;
  const found: BarcodeLookup = await (await lookup(app, code)).json();
  assert.deepEqual(found, { product: food, attribution: [] });
  assert.equal(products.requests.length, requestsBefore);

  // Others still get Open Food Facts' product until the community food is reviewed.
  const others: BarcodeLookup = await (await lookup(otherApp, code)).json();
  assert.equal(others.product.food.catalogRef?.provider, "open-food-facts");
});

void test("a food without a barcode is found by name, and wildcards are typed text", async () => {
  const created = await add(app, "soup-1", { ...label, name: "Sopa da avó 100%", brand: null, barcode: null, unit: "ml", serving: null });
  assert.equal(created.status, 201);
  const food: LabelFood = await created.json();
  assert.deepEqual(food.food.quantity, { amount: 100, unit: "ml" });

  assert.deepEqual((await search(app, "sopa avo"))[0], { kind: "community", ...food });
  assert.equal((await search(app, "100%")).some((item) => item.kind === "community"), true);
  assert.equal((await search(app, "sopa_")).some((item) => item.kind === "community"), false);
});

void test("erasing an account keeps the foods it added and forgets who added them", async () => {
  const leaving = signedInAs("user_test_leaving");
  const created = await add(leaving, "leaving-1", { ...label, name: "Pastel de feijão", barcode: null });
  assert.equal(created.status, 201);
  const id = await addedId(created);

  await client`DELETE FROM users WHERE clerk_user_id = 'user_test_leaving'`;

  const [row] = await client<{ user_id: string | null }[]>`SELECT user_id FROM community_foods WHERE id = ${id}`;
  assert.deepEqual(row, { user_id: null });
});
