import { createHarness, publishableKey } from "../harness.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { test } from "node:test";
import type { FoodInput } from "../../src/food/contract.js";

const { app, otherApp, client, userId, headers, signedInAs, setup, cleanup } = createHarness();

const first: FoodInput = {
  occurredAt: "2026-09-24T23:30:00Z",
  timeZone: "Europe/Lisbon",
  food: {
    name: "Oats",
    quantity: { amount: 80, unit: "g" },
    nutrients: { kcal: 311.125, proteinG: 13.2, carbsG: 53, fatG: 0 },
  },
};

function call(method: string, path: string, body?: FoodInput, key?: string, revision?: number) {
  const requestHeaders = new Headers(headers);

  if (key) requestHeaders.set("Idempotency-Key", key);

  if (revision) requestHeaders.set("If-Match", `"${revision}"`);
  const request: RequestInit = { method, headers: requestHeaders };

  if (body) request.body = JSON.stringify(body);

  return app.request(path, request);
}

void test("food CRUD, stable retries, day totals, and concurrent writes", async () => {
  await setup();

  try {
    const page = await app.request("/");
    assert.equal(page.status, 200);
    const pageHtml = await page.text();
    assert.match(pageHtml, /<div id="root"><\/div>/);
    assert.ok(pageHtml.includes(`<meta name="nouri-clerk-publishable-key" content="${publishableKey}" />`));
    assert.match(page.headers.get("Content-Security-Policy") ?? "", /connect-src 'self' https:\/\/example\.clerk\.accounts\.dev;/);

    const scriptPath = pageHtml.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];
    assert.ok(scriptPath);
    const script = await app.request(scriptPath);
    assert.equal(script.status, 200);
    // Routes load lazily, so the API client lives in a chunk the entry references rather than in the entry itself.
    const chunkPaths = new Set([...(await script.text()).matchAll(/["`](?:\.\/|assets\/)([^"`/]+\.js)["`]/g)].map((match) => `/assets/${match[1]}`));
    assert.ok(chunkPaths.size > 0);

    const chunks = await Promise.all([...chunkPaths].map(async (path) => {
      const chunk = await app.request(path);
      assert.equal(chunk.status, 200, path);

      return chunk.text();
    }));

    assert.ok(chunks.some((chunk) => chunk.includes("/v1/food-entries")));

    // Chunks named after dotted modules, like theme.stylex, load too.
    for (const file of await readdir(new URL("../../web/dist/assets", import.meta.url))) {
      assert.equal((await app.request(`/assets/${file}`)).status, 200, file);
    }

    assert.equal((await app.request("/assets/..js")).status, 404);

    const stylePath = pageHtml.match(/href="(\/assets\/[^" ]+\.css)"/)?.[1];
    assert.ok(stylePath);
    const stylesheet = await app.request(stylePath);
    assert.equal(stylesheet.status, 200);
    assert.match(stylesheet.headers.get("Content-Type") ?? "", /text\/css/);

    // Asset names carry their content hash, so browsers keep them; the page itself is always fetched fresh.
    assert.equal(stylesheet.headers.get("Cache-Control"), "public, max-age=31536000, immutable");
    assert.equal(page.headers.get("Cache-Control"), "no-store");
    const compressed = await app.request(stylePath, { headers: { "Accept-Encoding": "gzip" } });
    assert.equal(compressed.headers.get("Content-Encoding"), "gzip");
    assert.equal(await new Response(compressed.body?.pipeThrough(new DecompressionStream("gzip"))).text(), await (await app.request(stylePath)).text());

    const unauthorized = await app.request("/v1/days/2026-09-25");
    assert.equal(unauthorized.status, 401);

    // Someone new gets their own user on the first request, once, however many requests race to create it.
    const newcomer = signedInAs("user_newcomer");
    const visits = await Promise.all([1, 2, 3].map(async () => newcomer.request("/v1/days/2026-09-25", { headers })));
    assert.deepEqual(visits.map((visit) => visit.status), [200, 200, 200]);
    const newcomers = await client`SELECT id FROM users WHERE clerk_user_id = 'user_newcomer'`;
    assert.equal(newcomers.length, 1);
    assert.notEqual(newcomers[0]?.id, userId);

    const search = await app.request("/v1/foods/search?q=apple&locale=en", { headers });
    assert.equal(search.status, 200);
    const matches = await search.json();
    assert.equal(matches.items[0].name, "Apple, flesh and skin, raw");
    assert.equal(matches.items[0].ref.provider, "ciqual");
    assert.match(matches.attribution[0].label, /Anses/);

    const catalogBody = {
      occurredAt: "2026-09-26T12:00:00Z",
      timeZone: "Europe/Lisbon",
      food: { kind: "catalog", ref: matches.items[0].ref, quantity: { amount: 150, unit: "g" } },
    };

    const catalogHeaders = { ...headers, "Idempotency-Key": "catalog-apple-1" };
    const selected = await app.request("/v1/food-entries", { method: "POST", headers: catalogHeaders, body: JSON.stringify(catalogBody) });
    assert.equal(selected.status, 201);
    const logged = await selected.json();
    assert.deepEqual(logged.food.nutrients, { kcal: 81, proteinG: 0.375, carbsG: 17.4, fatG: 0.375 });
    assert.deepEqual(logged.food.catalogRef, matches.items[0].ref);
    assert.deepEqual(await (await app.request("/v1/food-entries", { method: "POST", headers: catalogHeaders, body: JSON.stringify(catalogBody) })).json(), logged);

    const oldCatalogBody = { ...catalogBody, food: { ...catalogBody.food, ref: { ...catalogBody.food.ref, version: "2024" } } };
    const oldRequestHash = createHash("sha256").update(JSON.stringify({ kind: "catalog-create", input: oldCatalogBody })).digest("hex");
    await client`INSERT INTO mutation_receipts (user_id, key, request_hash, outcome, body)
      VALUES (${userId}, ${"catalog-old-retry"}, ${oldRequestHash}, ${"created"}, ${JSON.stringify(logged)}::jsonb)`;

    const oldRetry = await app.request("/v1/food-entries", {
      method: "POST", headers: { ...headers, "Idempotency-Key": "catalog-old-retry" }, body: JSON.stringify(oldCatalogBody),
    });

    assert.equal(oldRetry.status, 201);
    assert.deepEqual(await oldRetry.json(), logged);

    const changedSelection = { ...catalogBody, food: { ...catalogBody.food, quantity: { amount: 100, unit: "g" } } };
    assert.equal((await app.request("/v1/food-entries", { method: "POST", headers: catalogHeaders, body: JSON.stringify(changedSelection) })).status, 409);

    const forged = { ...catalogBody, food: { name: logged.food.name, quantity: logged.food.quantity, nutrients: logged.food.nutrients, catalogRef: logged.food.catalogRef } };
    assert.equal((await app.request("/v1/food-entries", { method: "POST", headers: { ...headers, "Idempotency-Key": "catalog-forgery" }, body: JSON.stringify(forged) })).status, 400);

    const editedSelection = await app.request(`/v1/food-entries/${logged.id}`, {
      method: "PATCH",
      headers: { ...headers, "Idempotency-Key": "catalog-edit-1", "If-Match": '"1"' },
      body: JSON.stringify(changedSelection),
    });

    assert.equal(editedSelection.status, 200);
    const editedCatalog = await editedSelection.json();
    assert.equal(editedCatalog.food.nutrients.kcal, 54);
    assert.equal(editedCatalog.revision, 2);

    const missingFat = { ...catalogBody, food: { ...catalogBody.food, ref: { provider: "ciqual", id: "13620", version: "2025" } } };
    const missingCreated = await app.request("/v1/food-entries", { method: "POST", headers: { ...headers, "Idempotency-Key": "catalog-apple-2" }, body: JSON.stringify(missingFat) });
    assert.equal(missingCreated.status, 201);
    const missingLogged = await missingCreated.json();
    assert.equal(missingLogged.food.nutrients.fatG, null);
    const catalogDay = await call("GET", "/v1/days/2026-09-26");
    assert.equal((await catalogDay.json()).food.totals.fatG, null);
    // An entry from an older catalog release is logged again from its saved snapshot, not the current catalog.
    await client`UPDATE food_entries SET catalog_ref = ${JSON.stringify({ ...editedCatalog.food.catalogRef, version: "2024" })}::jsonb WHERE id = ${logged.id}`;
    const repeatBody = JSON.stringify({ occurredAt: "2026-09-27T08:00:00Z", timeZone: "Europe/Lisbon" });
    const repeatHeaders = { ...headers, "Idempotency-Key": "repeat-1" };
    const repeated = await app.request(`/v1/food-entries/${logged.id}/repeats`, { method: "POST", headers: repeatHeaders, body: repeatBody });
    assert.equal(repeated.status, 201);
    const repeatedEntry = await repeated.json();
    assert.notEqual(repeatedEntry.id, logged.id);
    assert.equal(repeatedEntry.localDate, "2026-09-27");
    assert.deepEqual(repeatedEntry.food, { ...editedCatalog.food, catalogRef: { ...editedCatalog.food.catalogRef, version: "2024" } });
    assert.deepEqual(await (await app.request(`/v1/food-entries/${logged.id}/repeats`, { method: "POST", headers: repeatHeaders, body: repeatBody })).json(), repeatedEntry);
    assert.equal((await otherApp.request(`/v1/food-entries/${logged.id}/repeats`, { method: "POST", headers: { ...headers, "Idempotency-Key": "repeat-2" }, body: repeatBody })).status, 404);
    assert.equal((await app.request(`/v1/food-entries/${logged.id}/repeats`, { method: "POST", headers: { ...headers, "Idempotency-Key": "repeat-3" }, body: JSON.stringify({ occurredAt: "2026-09-27T08:00:00Z" }) })).status, 400);
    assert.equal((await call("DELETE", `/v1/food-entries/${repeatedEntry.id}`, undefined, "repeat-delete-1", 1)).status, 204);

    assert.equal((await call("DELETE", `/v1/food-entries/${logged.id}`, undefined, "catalog-delete-1", 2)).status, 204);
    assert.equal((await call("DELETE", `/v1/food-entries/${missingLogged.id}`, undefined, "catalog-delete-2", 1)).status, 204);

    const [created, simultaneous] = await Promise.all([
      call("POST", "/v1/food-entries", first, "create-1"),
      call("POST", "/v1/food-entries", first, "create-1"),
    ]);

    assert.equal(created.status, 201);
    assert.equal(simultaneous.status, 201);
    const original = await created.json();
    assert.deepEqual(await simultaneous.json(), original);
    assert.equal(original.localDate, "2026-09-25");
    assert.equal(original.revision, 1);
    assert.equal(original.food.catalogRef, null);

    const thousandth = {
      ...first,
      food: { ...first.food, nutrients: { ...first.food.nutrients, kcal: 1.001 } },
    };

    const tiny = await call("POST", "/v1/food-entries", thousandth, "create-thousandth");
    assert.equal(tiny.status, 201);
    const tinyEntry = await tiny.json();
    assert.equal(tinyEntry.food.nutrients.kcal, 1.001);
    assert.equal((await call("DELETE", `/v1/food-entries/${tinyEntry.id}`, undefined, "delete-thousandth", 1)).status, 204);

    const foreignDay = await otherApp.request("/v1/days/2026-09-25", { headers });
    assert.equal((await foreignDay.json()).food.entryCount, 0);

    const foreignEdit = await otherApp.request(`/v1/food-entries/${original.id}`, {
      method: "PATCH", headers: { ...headers, "Idempotency-Key": "foreign-edit", "If-Match": '"1"' }, body: JSON.stringify(first),
    });

    assert.equal(foreignEdit.status, 404);

    const foreignDelete = await otherApp.request(`/v1/food-entries/${original.id}`, {
      method: "DELETE", headers: { ...headers, "Idempotency-Key": "foreign-delete", "If-Match": '"1"' },
    });

    assert.equal(foreignDelete.status, 404);

    const badReuse = await call("POST", "/v1/food-entries", { ...first, occurredAt: "2026-09-25T23:30:00Z" }, "create-1");
    assert.equal(badReuse.status, 409);

    const day = await call("GET", "/v1/days/2026-09-25");
    assert.equal(day.status, 200);
    assert.deepEqual((await day.json()).food.totals, { kcal: 311.125, proteinG: 13.2, carbsG: 53, fatG: 0 });

    const second = { ...first, occurredAt: "2026-09-24T12:00:00Z", food: { ...first.food, nutrients: { ...first.food.nutrients, carbsG: null } } };
    const secondCreated = await call("POST", "/v1/food-entries", second, "create-2");
    const secondEntry = await secondCreated.json();
    const incomplete = await call("GET", "/v1/days/2026-09-24");
    assert.deepEqual((await incomplete.json()).food.totals, { kcal: 311.125, proteinG: 13.2, carbsG: null, fatG: 0 });

    const editBody = { ...first, occurredAt: "2026-09-24T12:00:00Z", food: { ...first.food, name: "Oats edited" } };

    const [edited, stale] = await Promise.all([
      call("PATCH", `/v1/food-entries/${original.id}`, editBody, "edit-1", 1),
      call("PATCH", `/v1/food-entries/${original.id}`, { ...editBody, food: { ...editBody.food, name: "Other" } }, "edit-2", 1),
    ]);

    assert.deepEqual([edited.status, stale.status].sort((left, right) => left - right), [200, 409]);
    const winningEdit = edited.status === 200 ? edited : stale;
    const revised = await winningEdit.json();
    const winningKey = edited.status === 200 ? "edit-1" : "edit-2";
    const winningBody = edited.status === 200 ? editBody : { ...editBody, food: { ...editBody.food, name: "Other" } };
    assert.equal(revised.revision, 2);
    const editRetry = await call("PATCH", `/v1/food-entries/${original.id}`, winningBody, winningKey, 1);
    assert.deepEqual(await editRetry.json(), revised);
    const changedEditReuse = await call("PATCH", `/v1/food-entries/${original.id}`, first, winningKey, 1);
    assert.equal(changedEditReuse.status, 409);

    const oldDay = await call("GET", "/v1/days/2026-09-25");
    assert.equal((await oldDay.json()).food.entryCount, 0);
    const currentDay = await call("GET", "/v1/days/2026-09-24");
    assert.equal((await currentDay.json()).food.entryCount, 2);

    const deleted = await call("DELETE", `/v1/food-entries/${original.id}`, undefined, "delete-1", 2);
    assert.equal(deleted.status, 204);
    assert.equal((await call("DELETE", `/v1/food-entries/${original.id}`, undefined, "delete-1", 2)).status, 204);
    assert.equal((await call("DELETE", `/v1/food-entries/${original.id}`, undefined, "delete-1", 1)).status, 409);
    assert.equal((await call("DELETE", `/v1/food-entries/${secondEntry.id}`, undefined, "stale-delete", 2)).status, 409);
    assert.equal((await call("PATCH", `/v1/food-entries/${original.id}`, editBody, "edit-3", 2)).status, 404);
    const afterDelete = await call("GET", "/v1/days/2026-09-24");
    assert.equal((await afterDelete.json()).food.entryCount, 1);

    const originalRetry = await call("POST", "/v1/food-entries", first, "create-1");
    assert.deepEqual(await originalRetry.json(), original);
    const secondDelete = await call("DELETE", `/v1/food-entries/${secondEntry.id}`, undefined, "delete-2", 1);
    assert.equal(secondDelete.status, 204);
    const empty = await call("GET", "/v1/days/2026-09-24");
    assert.deepEqual((await empty.json()).food.totals, { kcal: null, proteinG: null, carbsG: null, fatG: null });

    const spec = await app.request("/openapi.json");
    assert.equal(spec.status, 200);
    const document = await spec.json();
    assert.ok(document.paths["/v1/food-entries"]);
    assert.ok(document.paths["/v1/food-entries"].post.responses["201"].content["application/json"].schema.properties.food.properties.catalogRef.type.includes("null"));
  } finally {
    await cleanup();
  }
});
