import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { CustomExerciseInput, ExerciseLibrary, LibraryExercise } from "../../src/exercises/contract.js";
import type { StrengthExercise } from "../../src/workouts/contract.js";

const { app, otherApp, token, setup, cleanup } = createHarness();

const auth = { Authorization: `Bearer ${token}` };

async function library(target = app): Promise<ExerciseLibrary> {
  const response = await target.request("/v1/exercises", { headers: auth });

  assert.equal(response.status, 200);

  return response.json();
}

function create(input: Omit<CustomExerciseInput, "equipment"> & { equipment: string | null }, key = randomUUID(), target = app) {
  return target.request("/v1/exercises", { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(input) });
}

async function logStrength(occurredAt: string, strengthExercises: StrengthExercise[]) {
  const response = await app.request("/v1/workouts", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ occurredAt, timeZone: "Europe/Lisbon", activity: "strength", durationMinutes: 45, distanceM: null, energyKcal: null, strengthExercises }),
  });

  assert.equal(response.status, 201);
}

const find = (exercises: LibraryExercise[], key: string) => exercises.find((exercise) => exercise.key === key);

void test("the exercise library merges the catalog, custom exercises, and logged names", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/exercises")).status, 401);

    const empty = await library();

    // The catalog is there before anything is logged, sorted by name.
    assert.ok(empty.exercises.length > 700);
    assert.ok(empty.exercises.every((exercise) => exercise.origin === "catalog"));
    assert.deepEqual(find(empty.exercises, "barbell squat"), { origin: "catalog", key: "barbell squat", name: "Barbell Squat", muscle: "quadriceps", muscles: { primary: ["quadriceps"], secondary: ["calves", "glutes", "hamstrings", "lower back"] }, equipment: "barbell" });
    assert.match(empty.attribution.url, /free-exercise-db/);

    // Logged names the catalog lacks join as logged exercises, under their latest spelling; catalog names stay catalog.
    await logStrength("2026-09-21T18:00:00Z", [{ name: "squat", sets: 3, reps: 8, weightKg: 60 }, { name: "barbell squat", sets: 1, reps: 5, weightKg: 80 }]);
    await logStrength("2026-09-24T18:00:00Z", [{ name: "Squat", sets: 3, reps: 8, weightKg: 62.5 }]);

    const logged = await library();

    assert.deepEqual(find(logged.exercises, "squat"), { origin: "logged", key: "squat", name: "Squat" });
    assert.equal(find(logged.exercises, "barbell squat")?.origin, "catalog");

    // A custom exercise may take a name only the history has, and then replaces the logged entry.
    const key = randomUUID();
    const created = await create({ name: " Squat ", muscle: "quadriceps", equipment: "barbell" }, key);

    assert.equal(created.status, 201);
    const squat = await created.json();

    assert.deepEqual(squat, { origin: "custom", id: squat.id, revision: 1, key: "squat", name: "Squat", muscle: "quadriceps", muscles: { primary: ["quadriceps"], secondary: [] }, equipment: "barbell" });
    // A retry returns the same exercise.
    assert.deepEqual(await (await create({ name: " Squat ", muscle: "quadriceps", equipment: "barbell" }, key)).json(), squat);
    assert.deepEqual(find((await library()).exercises, "squat"), squat);

    // Catalog names and other custom exercises' names are taken, whatever the case or spacing.
    const catalogName = await create({ name: "barbell  SQUAT", muscle: "quadriceps", equipment: "barbell" });

    assert.equal(catalogName.status, 409);
    assert.equal((await catalogName.json()).error, "An exercise named barbell  SQUAT already exists");
    assert.equal((await create({ name: "SQUAT", muscle: "glutes", equipment: null })).status, 409);
    assert.equal((await create({ name: "Squat", muscle: "quadriceps", equipment: "kettle" })).status, 400);

    // Another person's library has none of this.
    assert.equal(find((await library(otherApp)).exercises, "squat"), undefined);
    assert.equal((await create({ name: "Squat", muscle: "quadriceps", equipment: null }, randomUUID(), otherApp)).status, 201);

    // Deleting needs the current revision, and the logged name returns.
    const remove = (revision: number) => app.request(`/v1/exercises/${squat.id}`, { method: "DELETE", headers: { ...auth, "Idempotency-Key": randomUUID(), "If-Match": `"${revision}"` } });

    assert.equal((await remove(2)).status, 409);
    assert.equal((await remove(1)).status, 204);
    assert.equal((await remove(1)).status, 404);
    assert.deepEqual(find((await library()).exercises, "squat"), { origin: "logged", key: "squat", name: "Squat" });

    // The name is free again.
    assert.equal((await create({ name: "Squat", muscle: "glutes", equipment: "bodyweight" })).status, 201);
  } finally {
    await cleanup();
  }
});
