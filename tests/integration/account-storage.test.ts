import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createHarness } from "../harness.js";
import { maxAccountRecordBytes, maxTotalRecordBytes } from "../../src/account/storage.js";
import type { CommunityFoodInput, FoodSubmission } from "../../src/food/contract.js";
import type { MealInput } from "../../src/meals/contract.js";
import { localDate, shiftDate } from "../../src/time.js";
import type { WaterInput } from "../../src/water/contract.js";

const { app, otherApp, client, headers, userId, otherUserId, setup, cleanup } = createHarness();

const timeZone = "Europe/Lisbon";

const glass = { occurredAt: "2026-10-18T08:00:00Z", timeZone, volumeMl: 250 };

function post(target: typeof app, path: string, body: WaterInput | FoodSubmission | MealInput | CommunityFoodInput, key = randomUUID()) {
  return target.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

async function stored(owner: string): Promise<number> {
  const [row] = await client`SELECT bytes FROM account_storage WHERE user_id = ${owner}`;

  return Number(row?.bytes ?? 0);
}

// Tables owned by a person that the ledger deliberately leaves out: photos have their own quota, and receipts,
// sign-in states, and connections are short-lived or operational. The ledger itself is the last.
const untracked = ["progress_photos", "mutation_receipts", "wearable_oauth_states", "wearable_connections", "account_storage", "unowned_storage"];

void test("the storage ledger counts every write path and refuses new records past an allowance", async () => {
  await setup();

  try {
    // Every table with an owner is either counted or knowingly left out, so a new table cannot slip past.
    const owned = await client`SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'user_id'`;
    const triggered = await client`SELECT DISTINCT event_object_table AS table_name FROM information_schema.triggers WHERE trigger_schema = current_schema() AND action_statement LIKE '%track_account_storage%'`;
    const counted = new Set(triggered.map((row) => String(row.table_name)));
    assert.deepEqual(owned.map((row) => String(row.table_name)).filter((table) => !counted.has(table) && !untracked.includes(table)), []);

    const created = await post(app, "/v1/water-entries", glass);
    assert.equal(created.status, 201);
    const entry = await created.json();
    const afterOne = await stored(userId);
    assert.ok(afterOne > 0);

    // A soft delete keeps the row, so it frees nothing, and it is never refused.
    await client`UPDATE account_storage SET bytes = ${maxAccountRecordBytes} WHERE user_id = ${userId}`;
    const full = await post(app, "/v1/water-entries", glass);
    assert.equal(full.status, 413);
    assert.match((await full.json()).error, /storage allowance/);
    const removed = await app.request(`/v1/water-entries/${entry.id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": randomUUID(), "If-Match": '"1"' } });
    assert.equal(removed.status, 204);
    assert.equal((await post(otherApp, "/v1/water-entries", glass)).status, 201);

    // An edit that grows a row past the allowance is refused too; one that does not grow it still saves.
    await client`UPDATE account_storage SET bytes = ${maxAccountRecordBytes} WHERE user_id = ${userId}`;
    await assert.rejects(client`UPDATE water_entries SET time_zone = 'America/Argentina/ComodRivadavia' WHERE id = ${entry.id}`, (failure: Error & { code?: string }) => failure.code === "53Q01");
    await client`UPDATE water_entries SET volume_ml = 300 WHERE id = ${entry.id}`;

    // A refused write leaves no half-made receipt, so the same key works once there is room.
    const [pending] = await client`SELECT count(*) AS count FROM mutation_receipts WHERE outcome IS NULL`;
    assert.equal(Number(pending?.count), 0);
    await client`UPDATE account_storage SET bytes = ${maxAccountRecordBytes - 10_000} WHERE user_id = ${userId}`;
    assert.equal((await post(app, "/v1/water-entries", glass)).status, 201);

    // The app-wide ceiling refuses everyone's new rows.
    await client`UPDATE account_storage SET bytes = 0 WHERE user_id = ${userId}`;
    await client`UPDATE account_storage SET bytes = ${maxTotalRecordBytes} WHERE user_id = ${otherUserId}`;
    assert.equal((await post(app, "/v1/water-entries", glass)).status, 413);
    await client`UPDATE account_storage SET bytes = 0 WHERE user_id = ${otherUserId}`;

    // A daily meal due on a full account skips its fill, and the day still reads.
    const oats = await (await post(app, "/v1/food-entries", {
      occurredAt: "2026-10-18T07:30:00Z", timeZone, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 5 } },
    })).json();

    const meal = await (await post(app, "/v1/saved-meals", { name: "Breakfast", items: [{ entryId: oats.id, amount: 60 }], daily: null })).json();
    const today = localDate(new Date().toISOString(), timeZone);
    await client`UPDATE saved_meals SET daily_time = '00:00', daily_time_zone = ${timeZone}, daily_weekdays = '{1,2,3,4,5,6,7}', daily_filled_through = ${shiftDate(today, -2)} WHERE id = ${meal.id}`;
    await client`UPDATE account_storage SET bytes = ${maxAccountRecordBytes} WHERE user_id = ${userId}`;
    const day = await app.request(`/v1/days/${today}`, { headers });
    assert.equal(day.status, 200);
    const [filled] = await client`SELECT daily_filled_through AS through FROM saved_meals WHERE id = ${meal.id}`;
    assert.equal(String(filled?.through), shiftDate(today, -2));

    // With room again the fill catches up. Deleting rows outright gives their bytes back, and erasing the account drops its ledger row.
    await client`UPDATE account_storage SET bytes = ${afterOne} WHERE user_id = ${userId}`;
    await app.request(`/v1/days/${today}`, { headers });
    const [caughtUp] = await client`SELECT daily_filled_through AS through FROM saved_meals WHERE id = ${meal.id}`;
    assert.equal(String(caughtUp?.through), today);
    const before = await stored(userId);
    await client`DELETE FROM water_entries WHERE user_id = ${userId}`;
    assert.ok(await stored(userId) < before);
    // The author's community food outlives their account, so its bytes move to the app's unowned total.
    const shared = await post(app, "/v1/foods", { name: "Bolo de arroz", brand: "Pastelaria Aurora", barcode: "5601234567892", unit: "g", nutrientsPer100: { kcal: 410, proteinG: 6, carbsG: 55, fatG: 18 }, serving: { amount: 80 } });
    assert.equal(shared.status, 201);
    await client`DELETE FROM users WHERE id = ${userId}`;
    const [orphan] = await client`SELECT pg_column_size(c) AS bytes FROM community_foods c WHERE barcode = '5601234567892'`;
    const [unowned] = await client`SELECT bytes FROM unowned_storage`;
    assert.ok(Number(orphan?.bytes) > 0);
    assert.equal(Number(unowned?.bytes), Number(orphan?.bytes));
    const [ledger] = await client`SELECT count(*) AS count FROM account_storage WHERE user_id = ${userId}`;
    assert.equal(Number(ledger?.count), 0);
  } finally {
    await cleanup();
  }
});
