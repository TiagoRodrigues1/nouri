import { randomUUID } from "node:crypto";
import { and, count, eq, isNull, sum } from "drizzle-orm";
import { workouts } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import type { RecordKind } from "../journal/records.js";
import { localDate } from "../time.js";
import { workoutSchema } from "./contract.js";
import type { Workout, WorkoutDay, WorkoutInput, WorkoutSummary } from "./contract.js";

type WorkoutRow = typeof workouts.$inferSelect;

function workout(row: WorkoutRow): Workout {
  return {
    id: row.id,
    revision: row.revision,
    occurredAt: row.occurredAt.toISOString(),
    timeZone: row.timeZone,
    localDate: row.localDate,
    activity: row.activity,
    durationMinutes: row.durationMinutes,
    distanceM: row.distanceM,
    energyKcal: row.energyKcal,
    strengthExercises: row.strengthExercises,
  };
}

export const workoutRecords: RecordKind<WorkoutInput, Workout> = {
  name: "workout",
  table: workouts,
  schema: workoutSchema,
  create: async (tx, userId, input) => {
    const [row] = await tx.insert(workouts).values({
      id: randomUUID(),
      userId,
      occurredAt: new Date(input.occurredAt),
      timeZone: input.timeZone,
      localDate: localDate(input.occurredAt, input.timeZone),
      activity: input.activity,
      durationMinutes: input.durationMinutes,
      distanceM: input.distanceM,
      energyKcal: input.energyKcal,
      strengthExercises: input.strengthExercises,
    }).returning();

    if (!row) throw new Error("Workout insert returned no row");

    return workout(row);
  },
};

export async function getWorkoutDay(db: AppDatabase, userId: string, date: string): Promise<WorkoutDay> {
  const rows = await db.select().from(workouts).where(and(
    eq(workouts.userId, userId), eq(workouts.localDate, date), isNull(workouts.deletedAt),
  )).orderBy(workouts.occurredAt, workouts.id);

  const estimated = rows.every((row) => row.energyKcal !== null);

  return {
    entries: rows.map(workout),
    entryCount: rows.length,
    // A day without workouts is unrecorded activity, not zero minutes.
    totalMinutes: rows.length === 0 ? null : rows.reduce((sum, row) => sum + row.durationMinutes, 0),
    energyKcal: rows.length === 0 || !estimated ? null : rows.reduce((sum, row) => sum + (row.energyKcal ?? 0), 0),
  };
}

export async function getWorkoutSummary(db: AppDatabase, userId: string, date: string): Promise<WorkoutSummary> {
  const [row] = await db.select({ entryCount: count(), totalMinutes: sum(workouts.durationMinutes), burnedKcal: sum(workouts.energyKcal) }).from(workouts).where(and(
    eq(workouts.userId, userId), eq(workouts.localDate, date), isNull(workouts.deletedAt),
  ));

  return {
    entryCount: row?.entryCount ?? 0,
    totalMinutes: row?.totalMinutes == null ? null : Number(row.totalMinutes),
    burnedKcal: row?.burnedKcal == null ? null : Number(row.burnedKcal),
  };
}
