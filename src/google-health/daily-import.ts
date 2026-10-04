import type { ActivityRecord, HeartRateRecord, Pull } from "../wearables/provider.js";
import { sha256Base64url } from "../crypto.js";
import { dailyLimits, type BpmRange } from "../daily-totals/contract.js";
import { within } from "./data-point.js";

// One local day's value from a Google data type.
export type DayValue<V> = { localDate: string; value: V };

// A data type's values over the sync window. Each day is read whole, so nothing in it was skipped.
export type DaySeries<V> = { days: DayValue<V>[]; complete: boolean };

// Joins two daily series into one record per date. A day whose values are all out of range is skipped.
function byDay<A, B, R>(first: DaySeries<A>, second: DaySeries<B>, toRecord: (localDate: string, a: A | undefined, b: B | undefined) => R | null): Pull<R> {
  const firstValues = new Map(first.days.map((day) => [day.localDate, day.value]));
  const secondValues = new Map(second.days.map((day) => [day.localDate, day.value]));
  const dates = [...new Set([...firstValues.keys(), ...secondValues.keys()])].sort();
  const records: R[] = [];
  let skipped = 0;

  for (const date of dates) {
    const record = toRecord(date, firstValues.get(date), secondValues.get(date));

    if (record) records.push(record);
    else skipped += 1;
  }

  // Deleting a day needs both series to be whole, since either one may be what still has it.
  return { records, skipped, complete: first.complete && second.complete };
}

// Rollups carry no update time, so a day changes exactly when its values do.
const fingerprint = (values: (number | BpmRange | null)[]) => sha256Base64url(JSON.stringify(values));

export function activityRecords(steps: DaySeries<number>, energy: DaySeries<number>): Pull<ActivityRecord> {
  return byDay(steps, energy, (localDate, rawSteps, rawKcal) => {
    const daySteps = within(rawSteps, dailyLimits.steps.min, dailyLimits.steps.max);
    const activeKcal = within(rawKcal, dailyLimits.activeKcal.min, dailyLimits.activeKcal.max);

    if (daySteps === null && activeKcal === null) return null;

    return { localDate, steps: daySteps, activeKcal, fingerprint: fingerprint([daySteps, activeKcal]) };
  });
}

const bpm = (value: number | undefined) => within(value, dailyLimits.bpm.min, dailyLimits.bpm.max);

export function heartRateRecords(ranges: DaySeries<BpmRange>, resting: DaySeries<number>): Pull<HeartRateRecord> {
  return byDay(ranges, resting, (localDate, rawRange, rawResting) => {
    const restingBpm = bpm(rawResting);
    const [averageBpm, minBpm, maxBpm] = [bpm(rawRange?.averageBpm), bpm(rawRange?.minBpm), bpm(rawRange?.maxBpm)];
    // The day's range shows whole or not at all, so one odd value drops all three.
    const range = averageBpm !== null && minBpm !== null && maxBpm !== null && minBpm <= averageBpm && averageBpm <= maxBpm ? { averageBpm, minBpm, maxBpm } : null;

    if (restingBpm === null && range === null) return null;

    return { localDate, restingBpm, range, fingerprint: fingerprint([restingBpm, range]) };
  });
}
