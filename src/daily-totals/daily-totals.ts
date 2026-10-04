import { and, desc, eq } from "drizzle-orm";
import { dailyActivity, dailyHeartRate } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { bpmRange } from "./columns.js";
import type { ActivityDay, HeartRateDay } from "./contract.js";

// Each provider keeps its own row for a day. Their totals overlap, so the day shows the one that changed last.
const onDay = (table: typeof dailyActivity | typeof dailyHeartRate, userId: string, date: string) => and(eq(table.userId, userId), eq(table.localDate, date));

export async function getActivityDay(db: AppDatabase, userId: string, date: string): Promise<ActivityDay> {
  const [row] = await db.select().from(dailyActivity).where(onDay(dailyActivity, userId, date)).orderBy(desc(dailyActivity.updatedAt)).limit(1);

  return row ? { steps: row.steps, activeKcal: row.activeKcal, provider: row.source } : null;
}

export async function getHeartRateDay(db: AppDatabase, userId: string, date: string): Promise<HeartRateDay> {
  const [row] = await db.select().from(dailyHeartRate).where(onDay(dailyHeartRate, userId, date)).orderBy(desc(dailyHeartRate.updatedAt)).limit(1);

  return row ? { restingBpm: row.restingBpm, range: bpmRange(row), provider: row.source } : null;
}
