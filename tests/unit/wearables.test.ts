import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { wearablesFromEnv } from "../../src/google-health/config.js";
import { activeEnergyRollupSchema, exerciseDataPointSchema, heartRateRollupSchema, rollupPageSchema, sleepDataPointSchema, stepsRollupSchema } from "../../src/google-health/contract.js";
import { activityRecords, heartRateRecords } from "../../src/google-health/daily-import.js";
import { dailyLimits } from "../../src/daily-totals/contract.js";
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
    activity: "run", title: "Evening Run", durationMinutes: 40, distanceM: 8020, energyKcal: 512, device: "Google Fitbit Air",
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

void test("daily totals join by date and drop values Nouri cannot store", () => {
  const series = <V>(days: { localDate: string; value: V }[], complete = true) => ({ days, complete });

  const activity = activityRecords(
    series([{ localDate: "2026-09-24", value: 9037 }, { localDate: "2026-09-25", value: 500_000 }]),
    series([{ localDate: "2026-09-24", value: 412.6 }, { localDate: "2026-09-26", value: 90 }], false),
  );

  assert.deepEqual(activity.records.map(({ localDate, steps, activeKcal }) => [localDate, steps, activeKcal]), [["2026-09-24", 9037, 413], ["2026-09-26", null, 90]]);

  // An impossible step count leaves the day with nothing to store.
  assert.equal(activity.skipped, 1);
  assert.equal(activity.complete, false);

  const heart = heartRateRecords(
    series([
      { localDate: "2026-09-24", value: { averageBpm: 72, minBpm: 48, maxBpm: 161 } },
      { localDate: "2026-09-25", value: { averageBpm: 70, minBpm: 5, maxBpm: 150 } },
      { localDate: "2026-09-26", value: { averageBpm: 40, minBpm: 50, maxBpm: 150 } },
    ]),
    series([{ localDate: "2026-09-25", value: 61 }]),
  );

  // A range with an impossible value, or out of order, is dropped whole; the resting rate still stands.
  assert.deepEqual(heart.records.map(({ localDate, restingBpm, range }) => [localDate, restingBpm, range]), [
    ["2026-09-24", null, { averageBpm: 72, minBpm: 48, maxBpm: 161 }],
    ["2026-09-25", 61, null],
  ]);
  assert.equal(heart.skipped, 1);

  // Both series name a day at most once, and the join keeps one record per date, so a day's key is never inserted twice.
  const twice = activityRecords(series([{ localDate: "2026-09-24", value: 9037 }]), series([{ localDate: "2026-09-24", value: 400 }]));
  assert.deepEqual(twice.records.map((record) => record.localDate), ["2026-09-24"]);

  const [first] = activityRecords(series([{ localDate: "2026-09-24", value: 9037 }]), series([])).records;
  const [same] = activityRecords(series([{ localDate: "2026-09-24", value: 9037 }]), series([])).records;
  const [more] = activityRecords(series([{ localDate: "2026-09-24", value: 9038 }]), series([])).records;
  assert.equal(first?.fingerprint, same?.fingerprint);
  assert.notEqual(first?.fingerprint, more?.fingerprint);
});

void test("rollup buckets read their value or none", () => {
  assert.equal(stepsRollupSchema.parse({ civilStartTime: {}, steps: { countSum: "9037" } }), 9037);
  assert.equal(stepsRollupSchema.parse({ civilStartTime: {} }), null);
  assert.equal(activeEnergyRollupSchema.parse({ activeEnergyBurned: { kcalSum: 412.5 } }), 412.5);
  assert.deepEqual(heartRateRollupSchema.parse({ heartRate: { beatsPerMinuteAvg: 72, beatsPerMinuteMin: 48, beatsPerMinuteMax: 161 } }), { averageBpm: 72, minBpm: 48, maxBpm: 161 });
  assert.equal(rollupPageSchema.parse({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 9, day: 4 } } }] }).rollupDataPoints[0]?.civilStartTime.date, "2026-09-04");
  assert.equal(rollupPageSchema.safeParse({ rollupDataPoints: [{ civilStartTime: { date: { year: 2026, month: 2, day: 31 } } }] }).success, false);
});

void test("the database checks the same daily limits the import applies", () => {
  const schema = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
  const checks = [["steps", dailyLimits.steps], ["active_kcal", dailyLimits.activeKcal], ...["resting_bpm", "average_bpm", "min_bpm", "max_bpm"].map((column) => [column, dailyLimits.bpm] as const)] as const;

  for (const [column, { min, max }] of checks) assert.ok(schema.includes(`${column} integer CHECK (${column} BETWEEN ${min} AND ${max})`), column);
});
