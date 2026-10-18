import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type Target = ReturnType<typeof createHarness>["app"];

// The harness closes its database on cleanup, so each test has its own.
async function connect(target: Target, agentToken: string): Promise<Client> {
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

const timeZone = "Europe/Lisbon";

const date = "2026-10-07";

void test("the MCP server edits workouts, water, supplements, sleep, and measurements in place", async () => {
  const { app, otherApp, headers, agentToken, client: sql, userId, setup, cleanup } = createHarness();

  await setup();

  try {
    const client = await connect(app, agentToken);

    const water = (await call(client, "log_water", { date, time: "09:00", timeZone, volumeMl: 500 })).json();
    const more = await call(client, "edit_entry", { kind: "water", id: water.id, volumeMl: 750, time: "10:30" });
    assert.ok(!more.isError, more.text);
    assert.equal(more.json().id, water.id);
    assert.equal(more.json().revision, water.revision + 1);
    assert.equal(more.json().volumeMl, 750);
    assert.equal(more.json().occurredAt, "2026-10-07T09:30:00.000Z");

    // Only the kind's own fields apply, and the REST checks answer in words.
    const misplaced = await call(client, "edit_entry", { kind: "water", id: water.id, value: 3 });
    assert.ok(misplaced.isError);
    assert.match(misplaced.text, /value cannot be changed on a water/);
    const stranger = await call(client, "edit_entry", { kind: "measurement", id: water.id, value: 70 });
    assert.ok(stranger.isError);
    assert.match(stranger.text, /No measurement entry/);

    const run = (await call(client, "log_workout", { date, time: "18:00", activity: "run", durationMinutes: 30, distanceM: 5000 })).json();
    const strength = await call(client, "edit_entry", { kind: "workout", id: run.id, activity: "strength", distanceM: null, exercises: [{ name: "Squat", sets: 5, reps: 5, weightKg: 100 }] });
    assert.ok(!strength.isError, strength.text);
    assert.equal(strength.json().activity, "strength");
    assert.equal(strength.json().durationMinutes, 30);
    assert.equal(strength.json().strengthExercises[0].name, "Squat");
    const distance = await call(client, "edit_entry", { kind: "workout", id: run.id, distanceM: 1000 });
    assert.ok(distance.isError);
    assert.match(distance.text, /Strength workouts cannot have a distance\. Nothing was changed\./);

    // Wearable rows belong to their provider.
    const imported = "6f0e7b1c-4c2a-4a3e-8f4b-5c6d7e8f9a01";
    await sql`INSERT INTO workouts (id, user_id, occurred_at, time_zone, local_date, activity, duration_minutes, source, source_id, source_fingerprint)
      VALUES (${imported}, ${userId}, '2026-10-07T06:00:00Z', ${timeZone}, ${date}, 'walk', 20, 'google-health', 'walk-1', 'f1')`;
    const fromWatch = await call(client, "edit_entry", { kind: "workout", id: imported, durationMinutes: 25 });
    assert.ok(fromWatch.isError);
    assert.match(fromWatch.text, /imported from a wearable/);

    // A later wake time keeps the bedtime; a new date moves the whole night on its own wall clock.
    const night = (await call(client, "log_sleep", { date, bedtime: "23:30", wakeTime: "07:10" })).json();
    const longer = (await call(client, "edit_entry", { kind: "sleep", id: night.id, wakeTime: "07:40" })).json();
    assert.equal(longer.startedAt, "2026-10-06T22:30:00.000Z");
    assert.equal(longer.durationMinutes, 490);
    const earlier = (await call(client, "edit_entry", { kind: "sleep", id: night.id, date: "2026-10-06" })).json();
    assert.equal(earlier.localDate, "2026-10-06");
    assert.equal(earlier.durationMinutes, 490);
    assert.ok((await call(client, "edit_entry", { kind: "sleep", id: night.id, time: "07:00" })).isError);

    const weight = (await call(client, "log_measurement", { date, time: "07:00", kind: "weight", value: 72.4 })).json();
    assert.equal((await call(client, "edit_entry", { kind: "measurement", id: weight.id, value: 72.1 })).json().value, 72.1);
    assert.match((await call(client, "edit_entry", { kind: "measurement", id: weight.id, value: 5 })).text, /out of range/);

    // An intake moves only to a day its supplement is on the stack.
    const creatine = { id: "8a5d6f0e-7b1c-4c2a-9a3e-2f4b5c6d7e81", name: "Creatine", kind: "creatine", dose: { amount: 5, unit: "g" } };
    assert.equal((await app.request(`/v1/supplement-stack/${date}`, { method: "PUT", headers, body: JSON.stringify({ supplements: [creatine] }) })).status, 200);
    const [intake] = (await call(client, "take_supplements", { date, time: "08:00", supplementIds: [creatine.id] })).json().entries;
    assert.equal((await call(client, "edit_entry", { kind: "supplement", id: intake.id, time: "21:00" })).json().occurredAt, "2026-10-07T20:00:00.000Z");
    const beforeStack = await call(client, "edit_entry", { kind: "supplement", id: intake.id, date: "2026-10-01" });
    assert.ok(beforeStack.isError);
    assert.match(beforeStack.text, /not on your stack/);

    const other = await connect(otherApp, agentToken);
    assert.ok((await call(other, "edit_entry", { kind: "water", id: water.id, volumeMl: 100 })).isError);

    await client.close();
    await other.close();
  } finally {
    await cleanup();
  }
});

void test("the MCP server changes the supplement stack, targets, and saved meals", async () => {
  const { app, otherApp, headers, agentToken, setup, cleanup } = createHarness();

  await setup();

  try {
    const client = await connect(app, agentToken);
    await call(client, "log_water", { date, time: "09:00", timeZone, volumeMl: 250 });

    const started = await call(client, "change_supplement_stack", { date, add: [{ name: "Creatine", kind: "creatine", dose: { amount: 5, unit: "g" } }, { name: "Zinc", kind: "mineral", dose: { amount: 15, unit: "mg" } }] });
    assert.ok(!started.isError, started.text);
    const [creatine, zinc] = started.json().supplements;
    assert.equal(started.json().effectiveFrom, date);

    // Changes keep each supplement's id and place, and take effect from their date on.
    const later = "2026-10-10";
    const changed = await call(client, "change_supplement_stack", { date: later, change: [{ id: creatine.id, dose: { amount: 3, unit: "g" } }], remove: [zinc.id], add: [{ name: "Magnesium", kind: "mineral", dose: { amount: 400, unit: "mg" } }] });
    assert.ok(!changed.isError, changed.text);
    assert.deepEqual(changed.json().supplements.map((supplement: { name: string }) => supplement.name), ["Creatine", "Magnesium"]);
    assert.equal(changed.json().supplements[0].id, creatine.id);
    assert.equal(changed.json().supplements[0].dose.amount, 3);
    const before = await (await app.request(`/v1/supplement-stack/${date}`, { headers })).json();
    assert.equal(before.supplements.length, 2);
    assert.match((await call(client, "change_supplement_stack", { date, remove: ["8a5d6f0e-7b1c-4c2a-9a3e-2f4b5c6d7e89"] })).text, /No supplement .* on the stack/);

    const targets = await call(client, "change_targets", { date, kcal: 2400, proteinG: 150, weightKg: 70 });
    assert.ok(!targets.isError, targets.text);
    assert.equal(targets.json().targets.kcal, 2400);
    assert.equal(targets.json().targets.waterMl, 2000);
    assert.equal((await call(client, "change_targets", { date: later, weightKg: null })).json().targets.proteinG, 150);
    assert.equal((await call(client, "get_day", { date })).json().targets.targets.weightKg, 70);
    const tooLow = await call(client, "change_targets", { date, kcal: 10 });
    assert.ok(tooLow.isError);
    assert.match(tooLow.text, /kcal/);

    const oats = (await call(client, "log_meal", { date, time: "08:00", items: [{ name: "Oats", amount: 80, unit: "g", nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 5 } }] })).json().entries[0];
    const saved = await call(client, "save_meal", { name: "Breakfast", items: [{ entryId: oats.id, amount: 60 }, { name: "Milk", amount: 200, unit: "ml", nutrients: { kcal: 100, proteinG: 7, carbsG: 10, fatG: 4 } }], daily: { time: "07:30", weekdays: [1, 2, 3, 4, 5], from: "tomorrow" } });
    assert.ok(!saved.isError, saved.text);
    const meal = saved.json();
    assert.equal(meal.items[0].food.nutrients.kcal, 225);
    assert.deepEqual(meal.daily, { time: "07:30", timeZone, weekdays: [1, 2, 3, 4, 5] });
    // Starting tomorrow, today stays as the person logged it.
    assert.equal((await call(client, "list_saved_meals", {})).json().meals[0].lastLogged, null);

    const apple = (await call(client, "search_foods", { query: "apple" })).json().items[0];
    const edited = await call(client, "edit_saved_meal", { mealId: meal.id, name: "Weekday breakfast", remove: [meal.items[1].id], amounts: [{ id: meal.items[0].id, amount: 40 }], add: [{ ref: apple.ref, grams: 150 }], daily: { time: "08:00" } });
    assert.ok(!edited.isError, edited.text);
    assert.equal(edited.json().name, "Weekday breakfast");
    assert.deepEqual(edited.json().items.map((item: { food: { name: string } }) => item.food.name), ["Oats", apple.name]);
    assert.equal(edited.json().items[0].id, meal.items[0].id);
    assert.equal(edited.json().items[0].food.nutrients.kcal, 150);
    assert.deepEqual(edited.json().daily, { time: "08:00", timeZone, weekdays: [1, 2, 3, 4, 5] });
    assert.equal((await call(client, "edit_saved_meal", { mealId: meal.id, daily: null })).json().daily, null);
    assert.match((await call(client, "edit_saved_meal", { mealId: meal.id, remove: [oats.id] })).text, /no item/);
    assert.ok((await call(client, "edit_saved_meal", { mealId: meal.id, remove: edited.json().items.map((item: { id: string }) => item.id) })).isError);

    // A meal due today logs its old items before an edit changes them.
    const today = (await call(client, "get_day", {})).json().date;
    const due = await (await app.request("/v1/saved-meals", { method: "POST", headers: { ...headers, "Idempotency-Key": "due" }, body: JSON.stringify({ name: "Snack", items: [{ entryId: oats.id, amount: 80 }], daily: { time: "00:00", timeZone } }) })).json();
    assert.ok(!(await call(client, "edit_saved_meal", { mealId: due.id, amounts: [{ id: due.items[0].id, amount: 10 }] })).isError);
    const filled = (await call(client, "get_day", { date: today })).json().food.entries;
    assert.deepEqual(filled.map((entry: { food: { quantity: { amount: number } } }) => entry.food.quantity.amount), [80]);
    assert.ok(!(await call(client, "delete_saved_meal", { mealId: due.id })).isError);

    const other = await connect(otherApp, agentToken);
    assert.ok((await call(other, "delete_saved_meal", { mealId: meal.id })).isError);

    const deleted = await call(client, "delete_saved_meal", { mealId: meal.id });
    assert.ok(!deleted.isError, deleted.text);
    assert.deepEqual(deleted.json(), { deleted: { kind: "saved-meal", id: meal.id } });
    assert.equal((await call(client, "list_saved_meals", {})).json().meals.length, 0);
    assert.equal((await call(client, "get_day", { date })).json().food.entryCount, 1);

    await client.close();
    await other.close();
  } finally {
    await cleanup();
  }
});

void test("the page lists connected assistants and disconnects one, which ends its grant on its next call", async () => {
  const { app, otherApp, headers, agentToken, jwtAgentToken, revokedAgentTokens, setup, cleanup } = createHarness();

  await setup();

  try {
    assert.deepEqual(await (await app.request("/v1/assistants", { headers })).json(), { assistants: [] });

    const client = await connect(app, agentToken);
    await call(client, "get_day", { date });

    const { assistants } = await (await app.request("/v1/assistants", { headers })).json();
    assert.equal(assistants.length, 1);
    assert.equal(assistants[0].clientId, "client_claude");
    assert.equal(assistants[0].name, "Claude");
    assert.deepEqual(await (await otherApp.request("/v1/assistants", { headers })).json(), { assistants: [] });

    // Another person cannot disconnect it, and disconnecting takes no Idempotency-Key.
    assert.equal((await otherApp.request("/v1/assistants/client_claude", { method: "DELETE", headers })).status, 404);
    assert.equal((await app.request("/v1/assistants/client_claude", { method: "DELETE", headers })).status, 204);
    assert.equal((await app.request("/v1/assistants/client_claude", { method: "DELETE", headers })).status, 404);
    assert.deepEqual(await (await app.request("/v1/assistants", { headers })).json(), { assistants: [] });

    // Its next call is refused as unauthorized and ends the grant at Clerk.
    const refused = await app.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${agentToken}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    assert.equal(refused.status, 401);
    assert.match(refused.headers.get("WWW-Authenticate") ?? "", /resource_metadata=/);
    assert.ok(revokedAgentTokens.has(agentToken));

    // Let in again through Clerk's consent page, it starts afresh.
    revokedAgentTokens.clear();
    const again = await connect(app, agentToken);
    await call(again, "get_day", { date });
    assert.equal((await (await app.request("/v1/assistants", { headers })).json()).assistants.length, 1);

    // Clerk cannot revoke JWT access tokens, so a client that has them is listed but not disconnected.
    const jwtClient = await connect(app, jwtAgentToken);
    await call(jwtClient, "get_day", { date });
    const listed = (await (await app.request("/v1/assistants", { headers })).json()).assistants;
    assert.deepEqual(listed.map((assistant: { clientId: string; revocable: boolean }) => [assistant.clientId, assistant.revocable]).sort(), [["client_chatgpt", false], ["client_claude", true]]);
    const kept = await app.request("/v1/assistants/client_chatgpt", { method: "DELETE", headers });
    assert.equal(kept.status, 409);
    assert.match((await kept.json()).error, /JWT/);
    assert.ok(!(await call(jwtClient, "get_day", { date })).isError);

    await client.close();
    await again.close();
    await jwtClient.close();
  } finally {
    await cleanup();
  }
});
