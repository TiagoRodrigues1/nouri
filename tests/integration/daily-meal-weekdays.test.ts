import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoodSubmission } from "../../src/food/contract.js";
import type { MealInput } from "../../src/meals/contract.js";
import { isoWeekday, localDate, shiftDate } from "../../src/time.js";

const { app, client, headers, setup, cleanup } = createHarness();

const timeZone = "Europe/Lisbon";

function post(path: string, key: string, body: FoodSubmission | MealInput) {
  return app.request(path, { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
}

type Meal = { id: string; revision: number; name: string; daily: unknown; items: Array<{ id: string; food: { quantity: { amount: number } } }> };

let keys = 0;

// Sets daily the way the page does: the meal sent back whole with only its daily setting changed.
function setDaily(target: typeof app, meal: Meal, daily: { time: string; timeZone: string; weekdays?: number[] } | null, name = meal.name) {
  keys += 1;

  return target.request(`/v1/saved-meals/${meal.id}`, {
    method: "PATCH",
    headers: { ...headers, "Idempotency-Key": `daily-${keys}`, "If-Match": `"${meal.revision}"` },
    body: JSON.stringify({ name, items: meal.items.map((item) => ({ id: item.id, amount: item.food.quantity.amount })), daily }),
  });
}

async function foods(date: string): Promise<Array<{ id: string; revision: number; occurredAt: string; food: { name: string } }>> {
  return (await (await app.request(`/v1/days/${date}`, { headers })).json()).food.entries;
}

void test("a daily meal fills only its weekdays, and new weekdays apply from the next unfilled day", async () => {
  await setup();

  try {
    const today = localDate(new Date().toISOString(), timeZone);
    const others = [1, 2, 3, 4, 5, 6, 7].filter((day) => day !== isoWeekday(today));

    const oats = await (await post("/v1/food-entries", "oats", {
      occurredAt: "2026-09-25T07:30:00Z", timeZone, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 5 } },
    })).json();

    let meal: Meal = await (await post("/v1/saved-meals", "meal", { name: "Breakfast", items: [{ entryId: oats.id, amount: 80 }], daily: null })).json();

    const save = async (response: Response) => {
      assert.equal(response.status, 200);
      meal = await response.json();

      return meal;
    };

    // Every weekday but today's, sent out of order, is kept in order. Today is skipped as it turns on.
    assert.deepEqual((await save(await setDaily(app, meal, { time: "08:00", timeZone, weekdays: others.toReversed() }))).daily, { time: "08:00", timeZone, weekdays: others });
    assert.equal((await foods(today)).length, 0);

    // A missed week fills the six days on its weekdays and skips today, and the cursor still reaches today.
    await client`UPDATE saved_meals SET daily_filled_through = ${shiftDate(today, -7)} WHERE id = ${meal.id}`;
    const week = await (await app.request(`/v1/review/${today}`, { headers })).json();
    assert.deepEqual(week.days.map((day: { food: { kcal: number | null } }) => day.food.kcal), [300, 300, 300, 300, 300, 300, null]);
    const [stored] = await client<{ through: string }[]>`SELECT daily_filled_through::text AS through FROM saved_meals WHERE id = ${meal.id}`;
    assert.equal(stored?.through, today);

    // Adding today's weekday after today was passed over leaves today empty until next week.
    await save(await setDaily(app, meal, { time: "08:00", timeZone, weekdays: [1, 2, 3, 4, 5, 6, 7] }));
    assert.equal((await foods(today)).length, 0);

    // No weekdays, an unknown one, or one twice is refused.
    for (const weekdays of [[], [0], [8], [1, 1], [1.5]]) {
      assert.equal((await setDaily(app, meal, { time: "08:00", timeZone, weekdays })).status, 400);
    }

    // A save sent before weekdays existed and retried with its key still replays, and naming every day matches it.
    const items = meal.items.map((item) => ({ id: item.id, amount: item.food.quantity.amount }));

    const retry = (daily: { time: string; timeZone: string; weekdays?: number[] }) => app.request(`/v1/saved-meals/${meal.id}`, {
      method: "PATCH", headers: { ...headers, "Idempotency-Key": "retried", "If-Match": `"${meal.revision}"` }, body: JSON.stringify({ name: meal.name, items, daily }),
    });

    const first = await retry({ time: "07:00", timeZone });
    assert.equal(first.status, 200);
    assert.equal((await retry({ time: "07:00", timeZone, weekdays: [7, 6, 5, 4, 3, 2, 1] })).status, 200);
    assert.equal((await retry({ time: "07:00", timeZone, weekdays: [1, 2, 3] })).status, 409);
    meal = await first.json();

    // Off clears the weekdays with the time.
    assert.equal((await save(await setDaily(app, meal, null))).daily, null);
    const [off] = await client<{ weekdays: number[] | null }[]>`SELECT daily_weekdays AS weekdays FROM saved_meals WHERE id = ${meal.id}`;
    assert.equal(off?.weekdays, null);
  } finally {
    await cleanup();
  }
});
