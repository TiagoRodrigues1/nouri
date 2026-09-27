import type { Activity } from "../workouts/contract.js";
import type { WorkoutRecord } from "../wearables/provider.js";
import { localDate } from "../time.js";
import type { ExerciseDataPoint } from "./contract.js";
import { sha256Base64url } from "../crypto.js";
import { deviceName, durationSeconds, offsetZone } from "./data-point.js";

// Google names well over a hundred exercise types; Nouri keeps six. The session's own name keeps the detail.
const activityGroups: [Activity, string[]][] = [
  ["run", ["RUNNING", "TRAIL_RUN", "TREADMILL", "INCLINE_RUN", "TRACK_AND_FIELD"]],
  ["walk", ["WALKING", "POWER_WALKING", "NORDIC_WALKING", "TREADMILL_WALK", "INCLINE_WALK", "HIKING", "STROLLER_WALK", "WALK_WITH_WEIGHTS", "RUCKING", "BACKPACKING"]],
  ["cycle", ["BIKING", "OUTDOOR_BIKE", "MOUNTAIN_BIKE", "STATIONARY_BIKE", "SPINNING", "ASSAULT_BIKE", "HAND_CYCLING"]],
  ["swim", ["SWIMMING", "SWIMMING_POOL", "SWIMMING_OPEN_WATER"]],
  ["strength", ["STRENGTH_TRAINING", "WEIGHTLIFTING", "WEIGHTS", "FREE_WEIGHTS", "WEIGHT_MACHINES", "POWERLIFTING", "FUNCTIONAL_STRENGTH_TRAINING", "BODY_WEIGHT", "CALISTHENICS", "RESISTANCE_BANDS", "CORE_TRAINING", "CROSSFIT"]],
];

const activityByType = new Map(activityGroups.flatMap(([activity, types]) => types.map((type) => [type, activity] as const)));

// Values outside what a Nouri workout stores become unknown rather than rejecting the session.
function within(value: number | undefined, min: number, max: number): number | null {
  if (value === undefined) return null;
  const rounded = Math.round(value);

  return rounded >= min && rounded <= max ? rounded : null;
}

// Null when the point cannot be a Nouri workout: it must last between 1 minute and 24 hours.
export function workoutRecord(point: ExerciseDataPoint): WorkoutRecord | null {
  const { interval, metricsSummary } = point.exercise;
  const occurredAt = new Date(interval.startTime);
  const elapsedSeconds = (Date.parse(interval.endTime) - occurredAt.getTime()) / 1000;

  if (!(elapsedSeconds > 0)) return null;

  // Active time leaves out pauses, so it is what the Fitbit app reports as the workout's length.
  const durationMinutes = Math.round((durationSeconds(point.exercise.activeDuration) ?? elapsedSeconds) / 60);

  if (durationMinutes < 1 || durationMinutes > 1440) return null;

  const timeZone = offsetZone(interval.startUtcOffset);
  const activity = activityByType.get(point.exercise.exerciseType ?? "") ?? "other";
  const title = point.exercise.displayName?.trim() || null;
  const distanceM = activity === "strength" || metricsSummary?.distanceMillimeters === undefined ? null : within(metricsSummary.distanceMillimeters / 1000, 1, 1_000_000);
  const energyKcal = within(metricsSummary?.caloriesKcal, 0, 10_000);
  const device = deviceName(point.dataSource);
  const content = [occurredAt.toISOString(), timeZone, activity, title, durationMinutes, distanceM, energyKcal, device];

  return {
    externalId: point.name,
    fingerprint: sha256Base64url(JSON.stringify([point.exercise.updateTime ?? null, ...content])),
    occurredAt,
    timeZone,
    // A workout belongs to the day it started on, in the offset where it started.
    localDate: localDate(interval.startTime, timeZone),
    activity,
    title,
    durationMinutes,
    distanceM,
    energyKcal,
    device,
  };
}
