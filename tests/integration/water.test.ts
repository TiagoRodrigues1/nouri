import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";

type WaterRequest = { occurredAt: string; timeZone: string; volumeMl: number };

const { app, otherApp, headers, setup, cleanup } = createHarness();

const glass: WaterRequest = { occurredAt: "2026-09-24T23:30:00Z", timeZone: "Europe/Lisbon", volumeMl: 250 };

function post(body: WaterRequest, key: string) {
  return app.request("/v1/water-entries", { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

function remove(target: typeof app, id: string, key: string, revision: number) {
  return target.request(`/v1/water-entries/${id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": key, "If-Match": `"${revision}"` } });
}

async function water(date: string) {
  return (await (await app.request(`/v1/days/${date}`, { headers })).json()).water;
}

void test("water logging, retries, day totals, and deletion", async () => {
  await setup();

  try {
    assert.deepEqual(await water("2026-09-25"), { entries: [], entryCount: 0, totalMl: null });

    const [created, simultaneous] = await Promise.all([post(glass, "water-1"), post(glass, "water-1")]);
    assert.equal(created.status, 201);
    assert.equal(simultaneous.status, 201);
    const first = await created.json();
    assert.deepEqual(await simultaneous.json(), first);
    assert.equal(first.localDate, "2026-09-25");
    assert.equal(first.volumeMl, 250);
    assert.equal(first.revision, 1);

    assert.equal((await post({ ...glass, volumeMl: 500 }, "water-1")).status, 409);
    assert.equal((await post({ ...glass, volumeMl: 0 }, "water-zero")).status, 400);
    assert.equal((await post({ ...glass, volumeMl: 12.5 }, "water-fraction")).status, 400);
    assert.equal((await post({ ...glass, volumeMl: 5001 }, "water-huge")).status, 400);
    assert.equal((await app.request("/v1/water-entries", { method: "POST", headers, body: JSON.stringify(glass) })).status, 400);

    const second = await (await post({ ...glass, occurredAt: "2026-09-25T08:00:00Z", volumeMl: 500 }, "water-2")).json();
    const day = await water("2026-09-25");
    assert.equal(day.entryCount, 2);
    assert.equal(day.totalMl, 750);
    assert.deepEqual(day.entries.map((entry: { id: string }) => entry.id), [first.id, second.id]);

    assert.equal((await (await otherApp.request("/v1/days/2026-09-25", { headers })).json()).water.entryCount, 0);
    assert.equal((await remove(otherApp, first.id, "foreign-delete", 1)).status, 404);
    assert.equal((await remove(app, first.id, "stale-delete", 2)).status, 409);

    assert.equal((await remove(app, first.id, "water-delete-1", 1)).status, 204);
    assert.equal((await remove(app, first.id, "water-delete-1", 1)).status, 204);
    assert.equal((await remove(app, first.id, "water-delete-2", 2)).status, 404);
    assert.deepEqual(await water("2026-09-25"), { ...day, entries: [day.entries[1]], entryCount: 1, totalMl: 500 });

    const food = { occurredAt: glass.occurredAt, timeZone: glass.timeZone, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 311, proteinG: 13, carbsG: 53, fatG: 5 } } };
    assert.equal((await app.request("/v1/food-entries", { method: "POST", headers: { ...headers, "Idempotency-Key": "water-1" }, body: JSON.stringify(food) })).status, 409);

    const spec = await (await app.request("/openapi.json")).json();
    assert.ok(spec.paths["/v1/water-entries"].post);
    assert.ok(spec.paths["/v1/days/{date}"].get.responses["200"].content["application/json"].schema.properties.water);
  } finally {
    await cleanup();
  }
});
