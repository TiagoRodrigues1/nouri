import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { FoodSubmission } from "../../src/food/contract.js";
import type { MealInput } from "../../src/meals/contract.js";
import { localDate, shiftDate } from "../../src/time.js";

const { app, otherApp, client, headers, setup, cleanup } = createHarness();

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

void test("a daily meal fills each day once with its foods, through today", async () => {
  await setup();

  try {
    const today = localDate(new Date().toISOString(), timeZone);

    const oats = await (await post("/v1/food-entries", "oats", {
      occurredAt: "2026-09-25T07:30:00Z", timeZone, food: { name: "Oats", quantity: { amount: 80, unit: "g" }, nutrients: { kcal: 300, proteinG: 10, carbsG: null, fatG: 5 } },
    })).json();

    let meal: Meal = await (await post("/v1/saved-meals", "meal", { name: "Breakfast", items: [{ entryId: oats.id, amount: 60 }], daily: null })).json();

    const save = async (response: Response) => {
      assert.equal(response.status, 200);
      meal = await response.json();

      return meal;
    };

    assert.equal(meal.daily, null);

    // Turning it on fills today at its time, once, however many reads race.
    // Weekdays left out mean every day, as before weekdays existed.
    assert.deepEqual((await save(await setDaily(app, meal, { time: "08:00", timeZone }))).daily, { time: "08:00", timeZone, weekdays: [1, 2, 3, 4, 5, 6, 7] });
    await Promise.all([foods(today), foods(today), app.request(`/v1/review/${today}`, { headers })]);
    const filled = await foods(today);
    assert.equal(filled.length, 1);
    assert.equal(filled[0]?.food.name, "Oats");
    assert.equal(new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(filled[0]?.occurredAt ?? "")), "08:00");
    assert.equal((await foods(shiftDate(today, -1))).length, 0);
    assert.equal((await foods(shiftDate(today, 1))).length, 0);
    assert.equal((await (await app.request("/v1/saved-meals", { headers })).json()).meals[0].daily.time, "08:00");

    // A deleted pre-filled food stays deleted, and turning the meal off and on the same day refills nothing.
    const [entry] = filled;
    assert.ok(entry);
    assert.equal((await app.request(`/v1/food-entries/${entry.id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": "skip", "If-Match": `"${entry.revision}"` } })).status, 204);
    await save(await setDaily(app, meal, null));
    await save(await setDaily(app, meal, { time: "08:00", timeZone }));
    assert.equal((await foods(today)).length, 0);

    // Days missed while the app was closed are filled on the next read, and count in the review. Editing the meal
    // or its time before that read never skips them.
    await client`UPDATE saved_meals SET daily_filled_through = ${shiftDate(today, -3)} WHERE id = ${meal.id}`;
    await save(await setDaily(app, meal, { time: "09:00", timeZone }, "Usual breakfast"));
    const review = await (await app.request(`/v1/review/${today}`, { headers })).json();
    assert.deepEqual(review.days.slice(-3).map((day: { food: { kcal: number | null } }) => day.food.kcal), [225, 225, 225]);
    assert.equal((await foods(shiftDate(today, -2))).length, 1);

    // Off stops future days and keeps the filled ones; a gone meal or another person's meal is not found.
    await client`UPDATE saved_meals SET daily_filled_through = ${shiftDate(today, -1)} WHERE id = ${meal.id}`;
    assert.equal((await save(await setDaily(app, meal, null))).daily, null);
    assert.equal((await foods(today)).length, 1);
    assert.equal((await setDaily(otherApp, meal, { time: "08:00", timeZone })).status, 404);
    assert.equal((await setDaily(app, meal, { time: "8:00", timeZone })).status, 400);
    assert.equal((await setDaily(app, meal, { time: "08:00", timeZone: "Mars/Olympus" })).status, 400);

    // A deleted meal stops filling.
    await save(await setDaily(app, meal, { time: "08:00", timeZone }));
    await client`UPDATE saved_meals SET daily_filled_through = ${shiftDate(today, -1)} WHERE id = ${meal.id}`;
    const deleted = await app.request(`/v1/saved-meals/${meal.id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": "meal-delete", "If-Match": `"${meal.revision}"` } });
    assert.equal(deleted.status, 204);
    assert.equal((await foods(today)).length, 1);
    assert.equal((await setDaily(app, meal, { time: "08:00", timeZone })).status, 404);
  } finally {
    await cleanup();
  }
});
