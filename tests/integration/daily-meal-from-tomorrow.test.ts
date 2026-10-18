import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoodSubmission } from "../../src/food/contract.js";
import type { MealInput } from "../../src/meals/contract.js";
import { localDate, shiftDate } from "../../src/time.js";

const { app, client, headers, setup, cleanup } = createHarness();

const timeZone = "Europe/Lisbon";

function post(path: string, key: string, body: FoodSubmission | MealInput) {
  return app.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

type Meal = { id: string; revision: number; name: string; daily: unknown; items: Array<{ id: string; food: { quantity: { amount: number } } }> };

type Daily = { time: string; timeZone: string; weekdays?: number[]; from?: string };

// Sets daily the way the page does: the meal sent back whole with only its daily setting changed.
function setDaily(meal: Meal, daily: Daily | null, key: string) {
  return app.request(`/v1/saved-meals/${meal.id}`, {
    method: "PATCH",
    headers: { ...headers, "Idempotency-Key": key, "If-Match": `"${meal.revision}"` },
    body: JSON.stringify({ name: meal.name, items: meal.items.map((item) => ({ id: item.id, amount: item.food.quantity.amount })), daily }),
  });
}

async function foods(date: string): Promise<unknown[]> {
  return (await (await app.request(`/v1/days/${date}`, { headers })).json()).food.entries;
}

void test("a daily meal turned on from tomorrow leaves today as it is", async () => {
  await setup();

  try {
    const today = localDate(new Date().toISOString(), timeZone);

    const oats = await (await post("/v1/food-entries", "oats", {
      occurredAt: new Date().toISOString(), timeZone, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 5 } },
    })).json();

    let meal: Meal = await (await post("/v1/saved-meals", "meal", { name: "Breakfast", items: [{ entryId: oats.id, amount: 80 }], daily: null })).json();

    const save = async (response: Response) => {
      assert.equal(response.status, 200);
      meal = await response.json();

      return meal;
    };

    // Today keeps only the oats logged by hand, and the start is not part of the setting.
    assert.deepEqual((await save(await setDaily(meal, { time: "08:00", timeZone, from: "tomorrow" }, "on"))).daily, { time: "08:00", timeZone, weekdays: [1, 2, 3, 4, 5, 6, 7] });
    assert.equal((await foods(today)).length, 1);
    const [stored] = await client<{ through: string }[]>`SELECT daily_filled_through::text AS through FROM saved_meals WHERE id = ${meal.id}`;
    assert.equal(stored?.through, today);

    // Tomorrow fills as usual.
    await client`UPDATE saved_meals SET daily_filled_through = ${shiftDate(today, -1)} WHERE id = ${meal.id}`;
    assert.equal((await foods(today)).length, 2);

    // A meal already on ignores the start, so an edit never skips a day not yet filled.
    await client`UPDATE saved_meals SET daily_filled_through = ${shiftDate(today, -2)} WHERE id = ${meal.id}`;
    await save(await setDaily(meal, { time: "08:00", timeZone, from: "tomorrow" }, "edit"));
    assert.equal((await foods(shiftDate(today, -1))).length, 1);
    assert.equal((await foods(today)).length, 3);

    // Turning it off and on from today the same day refills nothing, as the cursor never moves back.
    await save(await setDaily(meal, null, "off"));
    await save(await setDaily(meal, { time: "08:00", timeZone, from: "today" }, "on-again"));
    assert.equal((await foods(today)).length, 3);

    // Only today and tomorrow are starts.
    assert.equal((await setDaily(meal, { time: "08:00", timeZone, from: "monday" }, "bad")).status, 400);

    // A start of today is fingerprinted as no start, so a save retried from before the choice existed still replays;
    // tomorrow is a different request under the same key.
    const off = await save(await setDaily(meal, null, "off-again"));
    const first = await setDaily(off, { time: "07:00", timeZone }, "retried");
    assert.equal(first.status, 200);
    assert.equal((await setDaily(off, { time: "07:00", timeZone, from: "today" }, "retried")).status, 200);
    assert.equal((await setDaily(off, { time: "07:00", timeZone, from: "tomorrow" }, "retried")).status, 409);
  } finally {
    await cleanup();
  }
});
