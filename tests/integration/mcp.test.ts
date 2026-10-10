import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolRequest, CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const { app, otherApp, headers, token, agentToken, setup, cleanup } = createHarness();

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

void test("the MCP server signs in through Clerk OAuth and logs meals and workouts", async () => {
  await setup();

  try {
    const unauthorized = await app.request("/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("WWW-Authenticate"), 'Bearer resource_metadata="http://localhost/.well-known/oauth-protected-resource/mcp"');

    const metadata = await (await app.request("/.well-known/oauth-protected-resource/mcp")).json();
    assert.equal(metadata.resource, "http://localhost/mcp");
    assert.deepEqual(metadata.authorization_servers, ["https://example.clerk.accounts.dev"]);

    // Each token works only where it was issued for.
    assert.equal((await app.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: "{}" })).status, 401);
    assert.equal((await app.request("/v1/days/2026-10-07", { headers: { Authorization: `Bearer ${agentToken}` } })).status, 401);

    const client = await connect(app);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [
      "delete_entry", "edit_food", "get_day", "list_saved_meals", "log_meal", "log_measurement", "log_saved_meal", "log_sleep", "log_water", "log_workout", "search_exercises", "search_foods", "take_supplements",
    ]);

    const toast = { name: "Wholemeal toast", amount: 35, unit: "g", nutrients: { kcal: 85, proteinG: 4, carbsG: 15, fatG: null } };
    const noZone = await call(client, "log_meal", { items: [toast] });
    assert.ok(noZone.isError);
    assert.match(noZone.text, /time zone/);

    const search = (await call(client, "search_foods", { query: "apple" })).json();
    const apple = search.items[0];
    assert.equal(apple.ref.provider, "ciqual");

    const meal = await call(client, "log_meal", { date: "2026-10-07", time: "00:30", timeZone: "Europe/Lisbon", items: [{ ref: apple.ref, grams: 150 }, toast] });
    assert.ok(!meal.isError, meal.text);
    const logged = meal.json();
    assert.equal(logged.date, "2026-10-07");
    assert.equal(logged.entries.length, 2);
    assert.equal(logged.entries[0].occurredAt, "2026-10-06T23:30:00.000Z");
    assert.equal(logged.entries[0].food.quantity.amount, 150);
    assert.deepEqual(logged.entries[1].food.nutrients, toast.nutrients);

    const unknown = await call(client, "log_meal", { date: "2026-10-07", items: [toast, { ref: { ...apple.ref, id: "missing" }, grams: 10 }] });
    assert.ok(unknown.isError);

    // The zone comes from the latest entry, so the workout lands on the same Lisbon day.
    const workout = await call(client, "log_workout", { date: "2026-10-07", time: "18:00", activity: "strength", durationMinutes: 40, exercises: [{ name: "Squat", sets: 5, reps: 5, weightKg: 100 }] });
    assert.ok(!workout.isError, workout.text);
    assert.equal(workout.json().occurredAt, "2026-10-07T17:00:00.000Z");
    assert.equal(workout.json().timeZone, "Europe/Lisbon");

    // The logged name joins the catalog in search, ahead of it, so the assistant keeps using the person's spelling.
    const squats = (await call(client, "search_exercises", { query: "SQUAT" })).json();
    assert.deepEqual(squats.exercises[0], { origin: "logged", key: "squat", name: "Squat" });
    assert.ok(squats.exercises.some((exercise: { name: string }) => exercise.name === "Barbell Squat"));

    const invalid = await call(client, "log_workout", { activity: "strength", durationMinutes: 40, distanceM: 1000 });
    assert.ok(invalid.isError);
    assert.match(invalid.text, /distance/);

    const day = (await call(client, "get_day", { date: "2026-10-07" })).json();
    assert.equal(day.food.entryCount, 2);
    assert.equal(day.food.totals.fatG, null);
    assert.equal(day.workouts.entryCount, 1);
    assert.equal(day.workouts.totalMinutes, 40);
    assert.ok(day.targets);

    // The web app sees the same records. Foods logged at one instant come back in id order.
    const ids = (entries: { id: string }[]) => entries.map((entry) => entry.id).sort();
    const webDay = await (await app.request("/v1/days/2026-10-07", { headers })).json();
    assert.deepEqual(ids(webDay.food.entries), ids(logged.entries));

    const removed = await call(client, "delete_entry", { kind: "food", id: logged.entries[1].id });
    assert.ok(!removed.isError, removed.text);
    assert.ok((await call(client, "delete_entry", { kind: "food", id: logged.entries[1].id })).isError);
    assert.ok(!(await call(client, "delete_entry", { kind: "workout", id: workout.json().id })).isError);

    const after = (await call(client, "get_day", { date: "2026-10-07" })).json();
    assert.equal(after.food.entryCount, 1);
    assert.equal(after.workouts.entryCount, 0);

    const other = await connect(otherApp);
    assert.equal((await call(other, "get_day", { date: "2026-10-07" })).json().food.entryCount, 0);
    assert.ok((await call(other, "delete_entry", { kind: "food", id: logged.entries[0].id })).isError);

    await client.close();
    await other.close();
  } finally {
    await cleanup();
  }
});
