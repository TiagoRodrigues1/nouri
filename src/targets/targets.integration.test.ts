import { createHarness } from "../test/harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultTargets } from "./contract.js";
import type { Targets } from "./contract.js";

const { app, otherApp, headers, setup, cleanup } = createHarness();

const cut = { ...defaultTargets, kcal: 1800, proteinG: 120, waterMl: 2500, weightKg: 72.5 };

// Loose on purpose: the tests send missing, extra, and out-of-range targets the API must reject.
type TargetsRequest = Partial<Targets> & { extra?: boolean };

function put(date: string, body: TargetsRequest) {
  return app.request(`/v1/targets/${date}`, { method: "PUT", headers, body: JSON.stringify(body) });
}

async function get(target: typeof app, date: string) {
  return (await target.request(`/v1/targets/${date}`, { headers })).json();
}

void test("targets default, carry forward from the day they take effect, and validate", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/targets/2026-09-01")).status, 401);
    assert.deepEqual(await get(app, "2026-09-01"), { effectiveFrom: null, targets: defaultTargets });

    const saved = await put("2026-09-03", cut);
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), { effectiveFrom: "2026-09-03", targets: cut });

    // Days before the change keep the defaults; the change holds until the next one.
    assert.deepEqual(await get(app, "2026-09-02"), { effectiveFrom: null, targets: defaultTargets });
    assert.deepEqual(await get(app, "2026-09-20"), { effectiveFrom: "2026-09-03", targets: cut });
    assert.deepEqual(await get(otherApp, "2026-09-20"), { effectiveFrom: null, targets: defaultTargets });

    const maintain = { ...cut, kcal: 2200, weightKg: null };
    assert.equal((await put("2026-09-10", maintain)).status, 200);
    assert.deepEqual(await get(app, "2026-09-09"), { effectiveFrom: "2026-09-03", targets: cut });
    assert.deepEqual(await get(app, "2026-09-10"), { effectiveFrom: "2026-09-10", targets: maintain });

    // Saving the same day again replaces that day's set instead of adding one.
    assert.equal((await put("2026-09-10", { ...maintain, steps: 8000 })).status, 200);
    assert.equal((await get(app, "2026-09-12")).targets.steps, 8000);

    assert.equal((await put("2026-09-10", { ...maintain, kcal: 0 })).status, 400);
    assert.equal((await put("2026-09-10", { ...maintain, workouts: 1.5 })).status, 400);
    assert.equal((await put("2026-09-10", { ...maintain, extra: true })).status, 400);
    const { steps: _steps, ...missingSteps } = maintain;
    assert.equal((await put("2026-09-10", missingSteps)).status, 400);
    assert.equal((await put("2026-13-01", maintain)).status, 400);
    assert.equal((await app.request("/v1/targets/yesterday", { headers })).status, 400);
    assert.equal((await get(app, "2026-09-12")).targets.steps, 8000);

    const spec = await (await app.request("/openapi.json")).json();
    assert.ok(spec.paths["/v1/targets/{date}"].get);
    assert.ok(spec.paths["/v1/targets/{date}"].put);
  } finally {
    await cleanup();
  }
});
