import { createHarness } from "../harness.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { z } from "zod";
import type { StrengthExercise, workoutInputSchema } from "../../src/workouts/contract.js";

const { app, otherApp, token, setup, cleanup } = createHarness();

const auth = { Authorization: `Bearer ${token}` };

const zone = "Europe/Lisbon";

async function post(body: z.input<typeof workoutInputSchema>, target = app) {
  const response = await target.request("/v1/workouts", { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });

  assert.equal(response.status, 201);

  return response.json();
}

function strength(occurredAt: string, strengthExercises: StrengthExercise[]): z.input<typeof workoutInputSchema> {
  return { occurredAt, timeZone: zone, activity: "strength", durationMinutes: 45, distanceM: null, energyKcal: null, strengthExercises };
}

async function history(target = app) {
  const response = await target.request("/v1/workouts/exercises", { headers: auth });

  assert.equal(response.status, 200);

  return response.json();
}

void test("exercise history groups sessions by name across workouts", async () => {
  await setup();

  try {
    assert.equal((await app.request("/v1/workouts/exercises")).status, 401);
    assert.deepEqual(await history(), { exercises: [] });

    const first = await post(strength("2026-09-21T18:00:00Z", [{ name: "Squat", sets: 3, reps: 8, weightKg: 60 }, { name: "Push-up", sets: 3, reps: 12, weightKg: null }]));
    // A back-off set logged as a second row, and the name typed differently, stay one session of one exercise. The first row's spelling names it.
    const second = await post(strength("2026-09-24T18:00:00Z", [{ name: "  squat ", sets: 3, reps: 8, weightKg: 65 }, { name: "SQUAT", sets: 1, reps: 12, weightKg: 50 }]));
    await post(strength("2026-09-26T18:00:00Z", [{ name: "Push-up", sets: 3, reps: 15, weightKg: null }, { name: "Dip", sets: 2, reps: 10, weightKg: null }, { name: "Dip", sets: 1, reps: 6, weightKg: 10 }]));
    // Runs and deleted workouts add nothing; another person's workouts stay theirs.
    await post({ occurredAt: "2026-09-27T08:00:00Z", timeZone: zone, activity: "run", durationMinutes: 30, distanceM: 5000, energyKcal: null });
    const removed = await post(strength("2026-09-28T18:00:00Z", [{ name: "Deadlift", sets: 1, reps: 5, weightKg: 140 }]));
    assert.equal((await app.request(`/v1/workouts/${removed.id}`, { method: "DELETE", headers: { ...auth, "Idempotency-Key": randomUUID(), "If-Match": `"${removed.revision}"` } })).status, 204);
    await post(strength("2026-09-29T18:00:00Z", [{ name: "Bench press", sets: 5, reps: 5, weightKg: 80 }]), otherApp);

    const { exercises } = await history();

    assert.deepEqual(exercises.map((exercise: { key: string; name: string }) => [exercise.key, exercise.name]), [["push-up", "Push-up"], ["dip", "Dip"], ["squat", "squat"]]);

    const [pushUps, dips, squats] = exercises;

    assert.deepEqual(squats.sessions, [
      { workoutId: first.id, date: "2026-09-21", occurredAt: "2026-09-21T18:00:00.000Z", sets: [{ sets: 3, reps: 8, weightKg: 60 }], topWeightKg: 60, totalReps: 24, volumeKg: 1440 },
      { workoutId: second.id, date: "2026-09-24", occurredAt: "2026-09-24T18:00:00.000Z", sets: [{ sets: 3, reps: 8, weightKg: 65 }, { sets: 1, reps: 12, weightKg: 50 }], topWeightKg: 65, totalReps: 36, volumeKg: 2160 },
    ]);
    // Bodyweight has no top weight or volume; one weighted row does not make a partial volume.
    assert.deepEqual(pushUps.sessions.map((session: { topWeightKg: number | null; totalReps: number; volumeKg: number | null }) => [session.topWeightKg, session.totalReps, session.volumeKg]), [[null, 36, null], [null, 45, null]]);
    assert.deepEqual([dips.sessions[0].topWeightKg, dips.sessions[0].totalReps, dips.sessions[0].volumeKg], [10, 26, null]);

    assert.deepEqual((await history(otherApp)).exercises.map((exercise: { key: string }) => exercise.key), ["bench press"]);

    // UTC order can disagree with the workout's local date when the user travels.
    await post({ ...strength("2026-10-01T09:00:00Z", [{ name: "Travel squat", sets: 2, reps: 5, weightKg: 70 }, { name: "September lift", sets: 1, reps: 5, weightKg: 50 }]), timeZone: "Pacific/Honolulu" }, otherApp);
    await post({ ...strength("2026-09-30T10:00:00Z", [{ name: "Travel squat", sets: 2, reps: 5, weightKg: 75 }, { name: "October lift", sets: 1, reps: 5, weightKg: 55 }]), timeZone: "Pacific/Kiritimati" }, otherApp);
    const travelHistory = (await history(otherApp)).exercises;
    const travel = travelHistory.find((exercise: { key: string }) => exercise.key === "travel squat");

    assert.deepEqual(travel.sessions.map((session: { date: string; topWeightKg: number }) => [session.date, session.topWeightKg]), [["2026-09-30", 70], ["2026-10-01", 75]]);
    assert.ok(travelHistory.findIndex((exercise: { key: string }) => exercise.key === "october lift") < travelHistory.findIndex((exercise: { key: string }) => exercise.key === "september lift"));
  } finally {
    await cleanup();
  }
});
