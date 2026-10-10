import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const { app, otherApp, headers, agentToken, setup, cleanup } = createHarness();

type Target = typeof app;

async function connect(target: Target): Promise<Client> {
  const client = new Client({ name: "test", version: "1.0.0" });

  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    fetch: async (url, init) => target.request(url, init),
    requestInit: { headers: { Authorization: `Bearer ${agentToken}` } },
  });

  // SAFETY: the transport implements Transport; the SDK declares sessionId as optional without `| undefined`, which this repo's exactOptionalPropertyTypes rejects.
  await client.connect(transport as Transport);

  return client;
}

async function call(client: Client, name: string, args: CallToolRequest["params"]["arguments"]) {
  // SAFETY: every Nouri tool answers with content and no task, the CallToolResult arm of callTool's union.
  const result = await client.callTool({ name, arguments: args }) as CallToolResult;
  const [content] = result.content;

  assert.equal(content?.type, "text");

  return { isError: result.isError === true, text: content.text, json: () => JSON.parse(content.text) };
}

void test("the MCP server logs water, supplements, sleep, measurements, and saved meals, and edits foods", async () => {
  await setup();

  try {
    const client = await connect(app);
    const timeZone = "Europe/Lisbon";
    const date = "2026-10-07";

    const water = await call(client, "log_water", { date, time: "09:00", timeZone, volumeMl: 500 });
    assert.ok(!water.isError, water.text);
    assert.equal(water.json().occurredAt, "2026-10-07T08:00:00.000Z");

    const weight = await call(client, "log_measurement", { date, time: "07:00", kind: "weight", value: 72.4 });
    assert.ok(!weight.isError, weight.text);
    const tooLight = await call(client, "log_measurement", { date, kind: "weight", value: 5 });
    assert.ok(tooLight.isError);
    assert.match(tooLight.text, /out of range/);

    // A bedtime after the wake time is the evening before, and the night belongs to the morning it ended.
    const sleep = await call(client, "log_sleep", { date, bedtime: "23:30", wakeTime: "07:10" });
    assert.ok(!sleep.isError, sleep.text);
    assert.equal(sleep.json().startedAt, "2026-10-06T22:30:00.000Z");
    assert.equal(sleep.json().durationMinutes, 460);
    assert.equal(sleep.json().localDate, date);

    const creatine = { id: "8a5d6f0e-7b1c-4c2a-9a3e-2f4b5c6d7e81", name: "Creatine", kind: "creatine", dose: { amount: 5, unit: "g" } };
    const zinc = { id: "8a5d6f0e-7b1c-4c2a-9a3e-2f4b5c6d7e82", name: "Zinc", kind: "mineral", dose: { amount: 15, unit: "mg" } };
    assert.equal((await app.request(`/v1/supplement-stack/${date}`, { method: "PUT", headers, body: JSON.stringify({ supplements: [creatine, zinc] }) })).status, 200);

    // One id off the stack logs none of them.
    const offStack = await call(client, "take_supplements", { date, supplementIds: [creatine.id, "8a5d6f0e-7b1c-4c2a-9a3e-2f4b5c6d7e89"] });
    assert.ok(offStack.isError);
    const taken = await call(client, "take_supplements", { date, time: "08:00", supplementIds: [creatine.id, zinc.id] });
    assert.ok(!taken.isError, taken.text);
    assert.deepEqual(taken.json().entries.map((entry: { name: string }) => entry.name), ["Creatine", "Zinc"]);

    const oats = await (await app.request("/v1/food-entries", { method: "POST", headers: { ...headers, "Idempotency-Key": "oats" }, body: JSON.stringify({
      occurredAt: "2026-10-01T07:30:00Z", timeZone, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 5 } },
    }) })).json();

    const saved = await (await app.request("/v1/saved-meals", { method: "POST", headers: { ...headers, "Idempotency-Key": "meal" }, body: JSON.stringify({ name: "Breakfast", items: [{ entryId: oats.id, amount: 80 }], daily: null }) })).json();

    const { meals } = (await call(client, "list_saved_meals", {})).json();
    assert.deepEqual(meals.map((meal: { name: string }) => meal.name), ["Breakfast"]);

    const whole = await call(client, "log_saved_meal", { date, time: "08:00", mealId: saved.id });
    assert.ok(!whole.isError, whole.text);
    assert.equal(whole.json().entries[0].food.quantity.amount, 80);
    const half = await call(client, "log_saved_meal", { date, time: "20:00", mealId: saved.id, items: [{ id: saved.items[0].id, amount: 40 }] });
    assert.ok(!half.isError, half.text);
    assert.equal(half.json().entries[0].food.nutrients.kcal, 150);
    assert.ok((await call(client, "log_saved_meal", { date, mealId: oats.id })).isError);

    // A new amount scales the nutrients; a new time keeps the entry's date and zone.
    const entry = whole.json().entries[0];
    const edited = await call(client, "edit_food", { id: entry.id, amount: 120, time: "09:15" });
    assert.ok(!edited.isError, edited.text);
    assert.equal(edited.json().food.nutrients.kcal, 450);
    assert.equal(edited.json().occurredAt, "2026-10-07T08:15:00.000Z");
    assert.equal(edited.json().revision, entry.revision + 1);

    // The person's own nutrients replace the catalog's, so the entry no longer claims Ciqual as its source.
    const apple = (await call(client, "search_foods", { query: "apple" })).json().items[0];
    const [logged] = (await call(client, "log_meal", { date, time: "16:00", items: [{ ref: apple.ref, grams: 150 }] })).json().entries;
    const own = (await call(client, "edit_food", { id: logged.id, name: "Green apple", nutrients: { kcal: 80, proteinG: null, carbsG: 20, fatG: null } })).json();
    assert.equal(own.food.name, "Green apple");
    assert.equal(own.food.catalogRef, null);
    assert.equal(own.food.quantity.amount, 150);

    const day = (await call(client, "get_day", { date })).json();
    assert.equal(day.date, date);
    assert.equal(day.food.entryCount, 3);
    assert.equal(day.water.totalMl, 500);
    assert.equal(day.supplements.items[0].intakes.length, 1);
    assert.equal(day.sleep.totalMinutes, 460);
    assert.equal(day.measurements.latest.weight.value, 72.4);

    for (const [kind, id] of [["water", water.json().id], ["sleep", sleep.json().id], ["measurement", weight.json().id], ["supplement", taken.json().entries[0].id]]) {
      const removed = await call(client, "delete_entry", { kind, id });
      assert.ok(!removed.isError, removed.text);
    }

    assert.ok((await call(client, "delete_entry", { kind: "water", id: water.json().id })).isError);

    const after = (await call(client, "get_day", { date })).json();
    assert.equal(after.water.totalMl, null);
    assert.equal(after.sleep.totalMinutes, null);
    assert.equal(after.measurements.entries.length, 0);
    assert.equal(after.supplements.items[0].intakes.length, 0);
    assert.equal(after.supplements.items[1].intakes.length, 1);

    // Another person's ids are not theirs to change.
    const other = await connect(otherApp);
    assert.ok((await call(other, "edit_food", { id: entry.id, amount: 10 })).isError);
    assert.ok((await call(other, "log_saved_meal", { date, timeZone, mealId: saved.id })).isError);

    await client.close();
    await other.close();
  } finally {
    await cleanup();
  }
});
