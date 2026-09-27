import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";

// Loose on purpose: the tests send unknown and repeated cards the API must reject.
type LayoutRequest = { cards: string[]; extra?: boolean } | null;

const { app, otherApp, client, headers, setup, cleanup } = createHarness();

function put(body: LayoutRequest) {
  return app.request("/v1/dashboard", { method: "PUT", headers, body: JSON.stringify(body) });
}

async function cards(target: typeof app) {
  return (await (await target.request("/v1/dashboard", { headers })).json()).cards;
}

void test("dashboard layout defaults, saving, and validation", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/dashboard")).status, 401);
    assert.deepEqual(await cards(app), ["totals", "water", "supplements", "mix", "activity"]);

    const saved = await put({ cards: ["meals", "totals"] });
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { cards: ["meals", "totals"] });
    assert.deepEqual(await cards(app), ["meals", "totals"]);
    assert.deepEqual(await cards(otherApp), ["totals", "water", "supplements", "mix", "activity"]);

    assert.equal((await put({ cards: [] })).status, 200);
    assert.deepEqual(await cards(app), []);

    assert.equal((await put({ cards: ["totals", "totals"] })).status, 400);
    assert.equal((await put({ cards: ["steps"] })).status, 400);
    assert.equal((await put({ cards: ["totals"], extra: true })).status, 400);
    assert.equal((await put(null)).status, 400);
    assert.deepEqual(await cards(app), []);

    // A card retired after it was saved disappears from the layout instead of breaking it.
    await client`UPDATE dashboard_layouts SET cards = ARRAY['quick-log', 'water']`;
    assert.deepEqual(await cards(app), ["water"]);

    const spec = await (await app.request("/openapi.json")).json();
    assert.ok(spec.paths["/v1/dashboard"].get);
    assert.ok(spec.paths["/v1/dashboard"].put);
  } finally {
    await cleanup();
  }
});
