import type { dailyHeartRate } from "../db/schema.js";
import type { BpmRange } from "./contract.js";

// daily_heart_rate keeps the range in three columns that are all set or all null.
export function bpmRangeColumns(range: BpmRange | null) {
  return { averageBpm: range?.averageBpm ?? null, minBpm: range?.minBpm ?? null, maxBpm: range?.maxBpm ?? null };
}

export function bpmRange({ averageBpm, minBpm, maxBpm }: typeof dailyHeartRate.$inferSelect): BpmRange | null {
  return averageBpm !== null && minBpm !== null && maxBpm !== null ? { averageBpm, minBpm, maxBpm } : null;
}
