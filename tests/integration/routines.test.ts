import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Routine, RoutineExercise, RoutineInput } from "../../src/routines/contract.js";
import type { StrengthExercise } from "../../src/workouts/contract.js";

let { app, otherApp, headers, setup, cleanup } = createHarness();

const landmine: RoutineExercise = { name: "Landmine press", sets: [{ reps: { min: 10, max: 10 } }] };

const push: RoutineInput = {
  name: "Push day",
  exercises: [{ name: "Barbell Bench Press - Medium Grip", sets: [{ reps: { min: 5, max: 5 } }, { reps: { min: 8, max: 12 } }, { reps: { min: 8, max: 12 } }] }, landmine],
};

// Routines as sent, including fields the contract refuses.
type RoutineBody = Omit<RoutineInput, "exercises"> & { exercises: (RoutineExercise & { notes?: string })[] };

function create(input: RoutineBody, key: string, target = app) {
  return target.request("/v1/routines", { method: "POST", headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(input) });
}

function edit(id: string, revision: number, input: RoutineBody, key: string, target = app) {
  return target.request(`/v1/routines/${id}`, { method: "PATCH", headers: { ...headers, "Idempotency-Key": key, "If-Match": `"${revision}"` }, body: JSON.stringify(input) });
}

function remove(id: string, revision: number, key: string, target = app) {
  return target.request(`/v1/routines/${id}`, { method: "DELETE", headers: { ...headers, "Idempotency-Key": key, "If-Match": `"${revision}"` } });
}

async function list(target = app): Promise<Routine[]> {
  const response = await target.request("/v1/routines", { headers });

  assert.equal(response.status, 200);

  return (await response.json()).routines;
}

void test("routines are created, edited whole, and deleted with receipts and revisions", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/routines")).status, 401, "reading routines needs a session");
    assert.deepEqual(await list(), [], "a new account has no routines");

    const [first, simultaneous] = await Promise.all([create(push, "push-1"), create(push, "push-1")]);
    assert.equal(first.status, 201);
    const routine: Routine = await first.json();
    assert.deepEqual(routine, { id: routine.id, revision: 1, ...push }, "the routine comes back as sent");
    assert.deepEqual(await simultaneous.json(), routine, "a simultaneous retry with the same key gets the same routine");
    assert.deepEqual(await (await create(push, "push-1")).json(), routine, "a later retry with the same key replays it");
    assert.deepEqual(await list(), [routine], "a retried create stores one routine");
    assert.equal((await create({ ...push, name: "Pull day" }, "push-1")).status, 409, "a key sent with another body is refused");

    assert.equal((await create({ ...push, exercises: [] }, "empty")).status, 400, "a routine needs an exercise");
    assert.equal((await create({ ...push, exercises: [{ name: "Dip", sets: [] }] }, "no-sets")).status, 400, "an exercise needs a set");
    assert.equal((await create({ ...push, exercises: [{ name: "Dip", sets: [{ reps: { min: 12, max: 8 } }] }] }, "backwards")).status, 400, "a rep range cannot run backwards");
    assert.equal((await create({ ...push, exercises: [{ name: "Dip", sets: [{ reps: { min: 0, max: 8 } }] }] }, "zero")).status, 400, "a rep target is at least 1");
    assert.equal((await create({ ...push, exercises: [{ name: "Dip", notes: "slow", sets: [{ reps: { min: 8, max: 8 } }] }] }, "notes")).status, 400, "unknown fields are refused");
    assert.equal((await create({ ...push, exercises: [{ name: "Dip", sets: Array.from({ length: 21 }, () => ({ reps: { min: 8, max: 8 } })) }] }, "too-many-sets")).status, 400, "an exercise has at most 20 sets");
    assert.equal((await create({ ...push, exercises: Array.from({ length: 21 }, () => landmine) }, "too-many-exercises")).status, 400, "a routine has at most 20 exercises");

    const second: Routine = await (await create({ name: "Legs", exercises: [{ name: "Barbell Squat", sets: [{ reps: { min: 5, max: 5 } }] }] }, "legs-1")).json();
    assert.deepEqual((await list()).map((saved) => saved.name), ["Legs", "Push day"], "routines list newest first");

    const changed = { name: "Push day B", exercises: [landmine] };
    const updated = await edit(routine.id, 1, changed, "push-edit");
    assert.equal(updated.status, 200);
    const edited: Routine = await updated.json();
    assert.deepEqual(edited, { id: routine.id, revision: 2, ...changed }, "an edit replaces the routine whole and moves its revision");
    assert.deepEqual(await (await edit(routine.id, 1, changed, "push-edit")).json(), edited, "a retried edit replays the same routine");
    assert.equal((await edit(routine.id, 1, push, "push-edit-stale")).status, 409, "an edit at an old revision is refused");
    assert.equal((await edit(routine.id, 2, { ...push, name: "" }, "push-edit-blank")).status, 400, "a routine needs a name");
    assert.equal((await app.request(`/v1/routines/${routine.id}`, { method: "PATCH", headers: { ...headers, "Idempotency-Key": "no-revision" }, body: JSON.stringify(push) })).status, 400, "an edit needs If-Match");

    assert.deepEqual(await list(otherApp), [], "another person sees none of these routines");
    assert.equal((await edit(routine.id, 2, push, "foreign-edit", otherApp)).status, 404, "another person cannot edit a routine");
    assert.equal((await remove(routine.id, 2, "foreign-delete", otherApp)).status, 404, "another person cannot delete a routine");

    assert.equal((await remove(routine.id, 1, "push-delete-stale")).status, 409, "deleting needs the current revision");
    assert.equal((await remove(routine.id, 2, "push-delete")).status, 204);
    assert.equal((await remove(routine.id, 2, "push-delete")).status, 204, "a retried delete replays");
    assert.equal((await remove(routine.id, 3, "push-delete-again")).status, 404, "a deleted routine is gone");
    assert.equal((await edit(routine.id, 3, push, "push-edit-gone")).status, 404, "a deleted routine cannot be edited");
    assert.deepEqual(await list(), [second], "only the other routine is left");
  } finally {
    await cleanup();
  }
});

void test("a strength workout takes up to 400 rows, as a long session logs", async () => {
  ({ app, otherApp, headers, setup, cleanup } = createHarness());
  await setup();

  try {
    const rows = (count: number): StrengthExercise[] => Array.from({ length: count }, (_, index) => ({ name: `Exercise ${index % 20}`, sets: 1, reps: 1 + (index % 12), weightKg: 20 + index }));

    const workout = (strengthExercises: StrengthExercise[], key: string) => app.request("/v1/workouts", {
      method: "POST",
      headers: { ...headers, "Idempotency-Key": key },
      body: JSON.stringify({ occurredAt: "2026-10-05T17:00:00Z", timeZone: "Europe/Lisbon", activity: "strength", durationMinutes: 75, distanceM: null, energyKcal: null, strengthExercises }),
    });

    const logged = await workout(rows(400), "long-session");
    assert.equal(logged.status, 201, "a 400-row workout is accepted");
    assert.equal((await logged.json()).strengthExercises.length, 400, "every row is kept");
    assert.equal((await workout(rows(401), "too-long")).status, 400, "a 401-row workout is refused");
  } finally {
    await cleanup();
  }
});
