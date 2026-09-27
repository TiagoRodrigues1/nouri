import { and, desc, eq, lte } from "drizzle-orm";
import { userTargets } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { defaultTargets } from "./contract.js";
import type { Targets, TargetsForDay } from "./contract.js";

type TargetsRow = typeof userTargets.$inferSelect;

// Named field by field so a column added to the table never reaches the response unannounced.
function targetsForDay(row: TargetsRow): TargetsForDay {
  return {
    effectiveFrom: row.effectiveFrom,
    targets: {
      kcal: row.kcal,
      proteinG: row.proteinG,
      carbsG: row.carbsG,
      fatG: row.fatG,
      waterMl: row.waterMl,
      steps: row.steps,
      sleepMinutes: row.sleepMinutes,
      fastingHours: row.fastingHours,
      burnedKcal: row.burnedKcal,
      exerciseMinutes: row.exerciseMinutes,
      workouts: row.workouts,
      weightKg: row.weightG === null ? null : row.weightG / 1000,
    },
  };
}

// Targets carry forward: a day uses the latest set that took effect on or before it.
export async function getTargets(db: AppDatabase, userId: string, date: string): Promise<TargetsForDay> {
  const [row] = await db.select().from(userTargets)
    .where(and(eq(userTargets.userId, userId), lte(userTargets.effectiveFrom, date)))
    .orderBy(desc(userTargets.effectiveFrom)).limit(1);

  return row ? targetsForDay(row) : { effectiveFrom: null, targets: defaultTargets };
}

// A full replacement of the set taking effect on that day, so repeating it changes nothing.
export async function saveTargets(db: AppDatabase, userId: string, effectiveFrom: string, targets: Targets): Promise<TargetsForDay> {
  const { weightKg, ...daily } = targets;
  const values = { ...daily, weightG: weightKg === null ? null : Math.round(weightKg * 1000), updatedAt: new Date() };

  const [row] = await db.insert(userTargets).values({ userId, effectiveFrom, ...values })
    .onConflictDoUpdate({ target: [userTargets.userId, userTargets.effectiveFrom], set: values })
    .returning();

  if (!row) throw new Error("Targets upsert returned no row");

  return targetsForDay(row);
}
