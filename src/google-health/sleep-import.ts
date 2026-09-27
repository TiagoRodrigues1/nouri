import type { Stages } from "../sleep/contract.js";
import type { SleepRecord } from "../wearables/provider.js";
import { localDate } from "../time.js";
import type { SleepDataPoint } from "./contract.js";
import { sha256Base64url } from "../crypto.js";
import { deviceName, offsetZone } from "./data-point.js";

const stageKeys = ["awake", "light", "deep", "rem"] as const satisfies (keyof Stages)[];

function bucket(type: string): keyof Stages | null {
  switch (type) {
    case "AWAKE": return "awake";
    case "LIGHT": return "light";
    case "DEEP": return "deep";
    case "REM": return "rem";
    default: return null;
  }
}

// Classic sleep (asleep, restless, awake) has no deep or REM split, so it imports without stages.
function stagesOf(sleep: SleepDataPoint["sleep"], lengthMinutes: number): Stages | null {
  if (sleep.type !== "STAGES") return null;
  const total: Stages = { awake: 0, light: 0, deep: 0, rem: 0 };
  const summary = sleep.summary?.stagesSummary ?? [];

  if (summary.length > 0) {
    // The summary holds the minutes the Fitbit app shows, so it wins over re-adding the stage intervals.
    for (const item of summary) {
      const key = bucket(item.type);

      if (key) total[key] += item.minutes;
    }
  } else if (sleep.stages?.length) {
    const seconds: Stages = { awake: 0, light: 0, deep: 0, rem: 0 };

    for (const stage of sleep.stages) {
      const key = bucket(stage.type);

      if (key) seconds[key] += (Date.parse(stage.endTime) - Date.parse(stage.startTime)) / 1000;
    }

    for (const key of stageKeys) total[key] = Math.floor(seconds[key] / 60);
  } else {
    return null;
  }

  const sum = stageKeys.reduce((minutes, key) => minutes + total[key], 0);

  return sum === 0 || sum > lengthMinutes ? null : total;
}

// Null when the point cannot be a Nouri session: it must end after it starts and last at most 24 hours.
export function sleepRecord(point: SleepDataPoint): SleepRecord | null {
  const { interval } = point.sleep;
  const startedAt = new Date(interval.startTime);
  const endedAt = new Date(interval.endTime);
  const lengthMinutes = (endedAt.getTime() - startedAt.getTime()) / 60_000;

  if (!(lengthMinutes > 0) || lengthMinutes > 1440) return null;

  const timeZone = offsetZone(interval.endUtcOffset);
  const stages = stagesOf(point.sleep, Math.round(lengthMinutes));
  const device = deviceName(point.dataSource);
  const content = [startedAt.toISOString(), endedAt.toISOString(), timeZone, stages, device];
  const updateTime = point.sleep.updateTime ?? null;

  return {
    externalId: point.name,
    fingerprint: sha256Base64url(JSON.stringify([updateTime, ...content])),
    startedAt,
    endedAt,
    timeZone,
    // A night belongs to the morning it ends on, in the offset where it ended.
    localDate: localDate(interval.endTime, timeZone),
    stages,
    device,
  };
}
