import assert from "node:assert/strict";
import { test } from "node:test";
import { wearablesFromEnv } from "../../src/google-health/config.js";
import { exerciseDataPointSchema, sleepDataPointSchema } from "../../src/google-health/contract.js";
import { sleepRecord } from "../../src/google-health/sleep-import.js";
import { workoutRecord } from "../../src/google-health/workout-import.js";
import { fixture, googleConfig } from "../fake-google.js";

void test("wearable configuration requires complete credentials, callback path, and encryption key", () => {
  assert.equal(wearablesFromEnv({}, fetch), undefined);

  const env = {
    GOOGLE_HEALTH_CLIENT_ID: googleConfig.clientId,
    GOOGLE_HEALTH_CLIENT_SECRET: googleConfig.clientSecret,
    GOOGLE_HEALTH_REDIRECT_URI: googleConfig.redirectUri,
    WEARABLE_TOKEN_KEY: "ab".repeat(32),
  };

  const runtime = wearablesFromEnv(env, fetch);
  assert.equal(runtime?.providers[0]?.id, "google-health");
  assert.equal(runtime?.tokenKey.toString("hex"), env.WEARABLE_TOKEN_KEY);

  for (const key of Object.keys(env)) {
    assert.throws(() => wearablesFromEnv({ ...env, [key]: undefined }, fetch));
  }

  assert.throws(() => wearablesFromEnv({ ...env, WEARABLE_TOKEN_KEY: "invalid" }, fetch));
  assert.throws(() => wearablesFromEnv({ ...env, GOOGLE_HEALTH_REDIRECT_URI: "http://localhost/wrong" }, fetch));
});

void test("sleep fingerprints detect content corrections with or without an update time", () => {
  const point = sleepDataPointSchema.parse(fixture("sleep-night"));

  for (const updateTime of [point.sleep.updateTime, undefined]) {
    const original = { ...point, sleep: { ...point.sleep, updateTime } };
    const corrected = { ...original, sleep: { ...original.sleep, interval: { ...original.sleep.interval, startTime: "2026-09-24T02:10:00Z" } } };
    assert.equal(sleepRecord(original)?.fingerprint, sleepRecord(structuredClone(original))?.fingerprint);
    assert.notEqual(sleepRecord(original)?.fingerprint, sleepRecord(corrected)?.fingerprint);
  }

  const revised = { ...point, sleep: { ...point.sleep, updateTime: "2026-09-25T00:00:00Z" } };
  assert.notEqual(sleepRecord(point)?.fingerprint, sleepRecord(revised)?.fingerprint);
});

void test("exercise points map onto Nouri workouts", () => {
  const run = exerciseDataPointSchema.parse(fixture("exercise-run"));
  const imported = workoutRecord(run);
  assert.deepEqual({ ...imported, fingerprint: undefined }, {
    externalId: run.name, fingerprint: undefined, occurredAt: new Date("2026-09-24T21:30:00Z"), timeZone: "-04:00", localDate: "2026-09-24",
    activity: "run", title: "Evening Run", durationMinutes: 40, distanceM: 8020, energyKcal: 512, device: "Fitbit Air",
  });

  const exercise = (patch: Partial<typeof run.exercise>) => workoutRecord({ ...run, exercise: { ...run.exercise, ...patch } });

  // Without active time the whole interval counts; unknown types become "other" and keep their name.
  assert.equal(exercise({ activeDuration: undefined })?.durationMinutes, 45);
  assert.deepEqual([exercise({ exerciseType: "YOGA", displayName: "Yoga" })?.activity, exercise({ exerciseType: "YOGA", displayName: "Yoga" })?.title], ["other", "Yoga"]);
  assert.equal(exercise({ exerciseType: "WEIGHTLIFTING" })?.distanceM, null);

  // Values a Nouri workout cannot hold become unknown; a session under a minute is skipped.
  assert.equal(exercise({ metricsSummary: { caloriesKcal: 20_000, distanceMillimeters: 0 } })?.energyKcal, null);
  assert.equal(exercise({ metricsSummary: { distanceMillimeters: 0 } })?.distanceM, null);
  assert.equal(exercise({ activeDuration: "20s" }), null);
  assert.equal(workoutRecord(exerciseDataPointSchema.parse(fixture("exercise-too-short"))), null);

  // Corrections change the fingerprint with or without a new update time.
  assert.notEqual(exercise({ updateTime: undefined })?.fingerprint, exercise({ updateTime: undefined, activeDuration: "2520s" })?.fingerprint);
  assert.notEqual(imported?.fingerprint, exercise({ updateTime: "2026-09-25T08:00:00Z" })?.fingerprint);
  assert.equal(imported?.fingerprint, workoutRecord(structuredClone(run))?.fingerprint);
});
