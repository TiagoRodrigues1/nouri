import assert from "node:assert/strict";
import { test } from "node:test";
import { createHarness } from "../harness.js";

void test("food routes preserve request parsing and publish their validation constraints", async () => {
  const { app, headers, setup, cleanup } = createHarness();
  await setup();

  try {
    const input = {
      occurredAt: "2026-10-04T12:00:00Z", timeZone: "Europe/Lisbon",
      food: { name: "Route oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 311, proteinG: 13, carbsG: 53, fatG: 5 } },
    };

    const writeHeaders = { ...headers, "Idempotency-Key": "create" };

    const expectError = async (response: Response, status: number, message: string) => {
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { error: message });
    };

    // Auth and retry-key checks still precede even malformed route input.
    await expectError(await app.request("/v1/food-entries", { method: "POST", body: "{" }), 401, "Unauthorized");
    await expectError(await app.request("/v1/food-entries", { method: "POST", headers, body: "{" }), 400, "Idempotency-Key required");
    await expectError(await app.request("/v1/food-entries", { method: "POST", headers: writeHeaders, body: "{" }), 400, "Invalid food entry");
    await expectError(await app.request("/v1/food-entries", { method: "POST", headers: writeHeaders }), 400, "Invalid food entry");

    const withoutType = new Headers(writeHeaders);
    withoutType.delete("Content-Type");
    // Bytes avoid fetch automatically adding text/plain to a string body.
    const created = await app.request("/v1/food-entries", { method: "POST", headers: withoutType, body: new TextEncoder().encode(JSON.stringify(input)) });
    assert.equal(created.status, 201);
    const entry = await created.json();
    const path = `/v1/food-entries/${entry.id}`;
    const replay = await app.request("/v1/food-entries", { method: "POST", headers: { ...writeHeaders, "Content-Type": "text/plain" }, body: JSON.stringify(input) });
    assert.equal(replay.status, 201);
    assert.deepEqual(await replay.json(), entry);

    const editHeaders = { ...headers, "Idempotency-Key": "edit", "If-Match": '"1"' };
    await expectError(await app.request(path, { method: "PATCH", headers: editHeaders, body: "{" }), 400, "Invalid food edit");
    await expectError(await app.request(`${path}/repeats`, { method: "POST", headers: writeHeaders, body: "{" }), 400, "Invalid food repeat");

    for (const revision of ["1", '"0"', '"01"', '"-1"', '"1.5"', '"9007199254740992"']) {
      await expectError(await app.request(path, { method: "DELETE", headers: { ...editHeaders, "If-Match": revision } }), 400, "Invalid food deletion");
    }

    await expectError(await app.request(path, { method: "DELETE", headers: writeHeaders }), 400, "Invalid food deletion");
    await expectError(await app.request(path, { method: "DELETE", headers: { ...editHeaders, "If-Match": '"2147483647"' } }), 409, "Revision conflict");

    const edited = await app.request(path, { method: "PATCH", headers: { ...editHeaders, "Idempotency-Key": "valid-edit", "Content-Type": "text/plain" }, body: JSON.stringify(input) });
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).revision, 2);
    const repeated = await app.request(`${path}/repeats`, { method: "POST", headers: { ...writeHeaders, "Idempotency-Key": "repeat" }, body: JSON.stringify({ occurredAt: input.occurredAt, timeZone: input.timeZone }) });
    assert.equal(repeated.status, 201);
    const recent = await app.request("/v1/foods/recent", { headers });
    assert.equal(recent.status, 200);
    assert.equal((await recent.json()).foods.length, 1);
    const removed = await app.request(path, { method: "DELETE", headers: { ...editHeaders, "Idempotency-Key": "remove", "If-Match": '"2"' } });
    assert.equal(removed.status, 204);

    const search = async (query: string) => app.request(`/v1/foods/search?${query}`, { headers });
    const ordinary = await search("q=apple&locale=en");
    assert.equal(ordinary.status, 200);
    const expected = await ordinary.json();
    const repeatedQuery = await search("q=%20apple%20&q=pear&locale=en&locale=invalid_locale");
    assert.equal(repeatedQuery.status, 200);
    assert.deepEqual(await repeatedQuery.json(), expected);
    assert.deepEqual(await (await search("q=apple")).json(), await (await search("q=apple&locale=pt-PT")).json());

    for (const query of ["q=a", `q=${"a".repeat(81)}`, "q=apple&locale=", "q=apple&locale=invalid_locale", "q=apple&locale=e", `q=apple&locale=en-${"a".repeat(40)}`]) {
      await expectError(await search(query), 400, "Invalid food search");
    }

    const spec = await (await app.request("/openapi.json")).json();
    const searchParams = spec.paths["/v1/foods/search"].get.parameters;
    const querySchema = searchParams.find((parameter: { name: string }) => parameter.name === "q").schema;
    const localeSchema = searchParams.find((parameter: { name: string }) => parameter.name === "locale").schema;
    assert.equal(querySchema.minLength, 2);
    assert.equal(querySchema.maxLength, 80);
    assert.equal(localeSchema.minLength, 2);
    assert.equal(localeSchema.maxLength, 35);
    assert.equal(localeSchema.default, "pt-PT");
    assert.equal(new RegExp(localeSchema.pattern).test("invalid_locale"), false);
    assert.equal(new RegExp(localeSchema.pattern).test("pt-PT"), true);
    const edit = spec.paths["/v1/food-entries/{id}"].patch;
    const revisionSchema = edit.parameters.find((parameter: { name: string }) => parameter.name.toLowerCase() === "if-match").schema;
    assert.equal(new RegExp(revisionSchema.pattern).test('"01"'), false);
    assert.match(revisionSchema.description, /9007199254740991/);
    assert.ok(edit.responses[400]);
    assert.ok(spec.paths["/v1/food-entries/{id}"].delete.responses[400]);
    assert.equal(edit.requestBody.required, true);
    assert.ok(edit.requestBody.content["*/*"]);
  } finally {
    await cleanup();
  }
});
