import { createHarness } from "../test/harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Supplement } from "./contract.js";

// Each test gets its own schema, because cleanup closes the harness's connections.
let { app, otherApp, headers, setup, cleanup } = createHarness();

const vitaminD: Supplement = { id: "5d1c6f2e-8a43-4f7b-9c0d-2b1e7a9f3c11", name: "Vitamin D3", kind: "vitamin", dose: { amount: 2000, unit: "IU" } };

const creatine: Supplement = { id: "a07e3b9d-1c52-4e8a-b6f4-9d2c0e1a7b22", name: "Creatine monohydrate", kind: "creatine", dose: { amount: 5, unit: "g" } };

function put(date: string, supplements: unknown[]) {
  return app.request(`/v1/supplement-stack/${date}`, { method: "PUT", headers, body: JSON.stringify({ supplements }) });
}

async function stack(target: typeof app, date: string) {
  return (await target.request(`/v1/supplement-stack/${date}`, { headers })).json();
}

function take(supplementId: string, occurredAt: string, key: string) {
  return app.request("/v1/supplement-intakes", { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify({ occurredAt, timeZone: "Europe/Lisbon", supplementId }) });
}

function undo(target: typeof app, id: string, key: string, revision: number) {
  return target.request(`/v1/supplement-intakes/${id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": key, "If-Match": `"${revision}"` } });
}

async function day(target: typeof app, date: string) {
  return (await (await target.request(`/v1/days/${date}`, { headers })).json()).supplements;
}

void test("supplement stacks carry forward and validate", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/supplement-stack/2026-09-01")).status, 401);
    assert.deepEqual(await stack(app, "2026-09-01"), { effectiveFrom: null, supplements: [] });

    const saved = await put("2026-09-03", [vitaminD]);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { effectiveFrom: "2026-09-03", supplements: [vitaminD] });

    assert.equal((await put("2026-09-10", [vitaminD, creatine])).status, 200);
    assert.deepEqual(await stack(app, "2026-09-02"), { effectiveFrom: null, supplements: [] });
    assert.deepEqual(await stack(app, "2026-09-09"), { effectiveFrom: "2026-09-03", supplements: [vitaminD] });
    assert.deepEqual(await stack(app, "2026-09-20"), { effectiveFrom: "2026-09-10", supplements: [vitaminD, creatine] });
    assert.deepEqual(await stack(otherApp, "2026-09-20"), { effectiveFrom: null, supplements: [] });

    // Saving the same day again replaces that day's list rather than adding a version.
    assert.equal((await put("2026-09-10", [creatine])).status, 200);
    assert.deepEqual(await stack(app, "2026-09-20"), { effectiveFrom: "2026-09-10", supplements: [creatine] });

    assert.equal((await put("2026-09-11", [vitaminD, vitaminD])).status, 400);
    assert.equal((await put("2026-09-11", [{ ...vitaminD, name: " " }])).status, 400);
    assert.equal((await put("2026-09-11", [{ ...vitaminD, dose: { amount: 0, unit: "IU" } }])).status, 400);
    assert.equal((await put("2026-09-11", [{ ...vitaminD, dose: { amount: 1, unit: "pill" } }])).status, 400);
    assert.equal((await put("2026-09-11", [{ ...vitaminD, kind: "protein" }])).status, 400);
    assert.equal((await put("2026-09-11", [{ ...vitaminD, extra: true }])).status, 400);
    assert.equal((await put("not-a-date", [vitaminD])).status, 400);
    assert.deepEqual(await stack(app, "2026-09-11"), { effectiveFrom: "2026-09-10", supplements: [creatine] });

    const spec = await (await app.request("/openapi.json")).json();
    assert.ok(spec.paths["/v1/supplement-stack/{date}"].put);
    assert.ok(spec.paths["/v1/supplement-intakes"].post.responses["404"]);
  } finally {
    await cleanup();
  }
});

void test("supplement intakes snapshot the stack and fill the day's checklist", async () => {
  ({ app, otherApp, headers, setup, cleanup } = createHarness());
  await setup();

  try {
    assert.deepEqual(await day(app, "2026-09-25"), { items: [], unlisted: [] });

    // Nothing is on the stack yet, and the refused key can be used again once it is.
    assert.equal((await take(creatine.id, "2026-09-25T07:00:00Z", "creatine-1")).status, 404);
    await put("2026-09-25", [vitaminD, creatine]);

    const [created, simultaneous] = await Promise.all([take(creatine.id, "2026-09-25T07:00:00Z", "creatine-1"), take(creatine.id, "2026-09-25T07:00:00Z", "creatine-1")]);
    assert.equal(created.status, 201);
    assert.equal(simultaneous.status, 201);
    const first = await created.json();
    assert.deepEqual(await simultaneous.json(), first);
    assert.equal(first.localDate, "2026-09-25");
    assert.equal(first.name, creatine.name);
    assert.deepEqual(first.dose, creatine.dose);

    assert.equal((await take(vitaminD.id, "2026-09-25T07:00:00Z", "creatine-1")).status, 409);
    assert.equal((await take("not-a-uuid", "2026-09-25T07:00:00Z", "bad-id")).status, 400);
    // The local day decides which stack applies: 23:30 UTC on the 24th is the 25th in Lisbon, 22:00 UTC is still the 24th.
    assert.equal((await take(vitaminD.id, "2026-09-24T23:30:00Z", "late-vitamin")).status, 201);
    assert.equal((await take(vitaminD.id, "2026-09-24T22:00:00Z", "early-vitamin")).status, 404);

    let checklist = await day(app, "2026-09-25");
    assert.deepEqual(checklist.items.map((item: { supplement: Supplement; intakes: unknown[] }) => [item.supplement.name, item.intakes.length]), [["Vitamin D3", 1], ["Creatine monohydrate", 1]]);
    assert.deepEqual(checklist.unlisted, []);
    assert.deepEqual(await day(otherApp, "2026-09-25"), { items: [], unlisted: [] });

    // Changing the dose keeps the id, so the checklist still counts the intake and the intake keeps what was taken.
    const loading = { ...creatine, dose: { amount: 20, unit: "g" } };
    await put("2026-09-25", [vitaminD, loading]);
    checklist = await day(app, "2026-09-25");
    assert.deepEqual(checklist.items[1].supplement.dose, loading.dose);
    assert.deepEqual(checklist.items[1].intakes[0].dose, creatine.dose);

    // Dropping a supplement from the day's stack keeps its intake visible so it can be undone.
    await put("2026-09-25", [vitaminD]);
    checklist = await day(app, "2026-09-25");
    assert.equal(checklist.items.length, 1);
    assert.deepEqual(checklist.unlisted.map((entry: { id: string }) => entry.id), [first.id]);

    assert.equal((await undo(otherApp, first.id, "foreign-undo", 1)).status, 404);
    assert.equal((await undo(app, first.id, "stale-undo", 2)).status, 409);
    assert.equal((await undo(app, first.id, "undo-1", 1)).status, 204);
    assert.equal((await undo(app, first.id, "undo-1", 1)).status, 204);
    assert.deepEqual((await day(app, "2026-09-25")).unlisted, []);

    // Later days carry the stack forward with nothing taken yet.
    assert.deepEqual(await day(app, "2026-09-26"), { items: [{ supplement: vitaminD, intakes: [] }], unlisted: [] });
  } finally {
    await cleanup();
  }
});
