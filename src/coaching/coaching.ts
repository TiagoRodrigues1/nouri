import type { ReviewPeriod } from "../review/contract.js";
import { calorieTolerance, weekLength } from "../review/contract.js";
import { coachingPolicy } from "./contract.js";
import type { Suggestion } from "./contract.js";

const { minEvidenceDays, sleepShortfallMinutes } = coachingPolicy;

function amount(value: number, unit: string): string {
  return `${Math.round(value).toLocaleString("en-US")} ${unit}`;
}

// Written as the page writes durations.
function hours(minutes: number): string {
  const rounded = Math.round(minutes);
  const whole = Math.floor(rounded / 60);

  return whole ? `${whole} h ${rounded % 60} min` : `${rounded} min`;
}

function days(count: number, of: number): string {
  return `${count} of ${of} ${of === 1 ? "day" : "days"}`;
}

// Food rules need enough complete days; with fewer, the only suggestion is to log more.
function food({ nutrition }: ReviewPeriod): Suggestion[] {
  const { completeDays, kcal, proteinG } = nutrition;

  if (completeDays < minEvidenceDays) {
    return [{
      kind: "log-food",
      title: "Log every food for a few more days",
      because: `Complete food records on ${days(completeDays, weekLength)}. Nouri compares calories and protein once ${minEvidenceDays} days are complete.`,
    }];
  }

  const suggestions: Suggestion[] = [];

  if (proteinG.average !== null && proteinG.averageTarget !== null && proteinG.daysOnTarget * 2 < completeDays) {
    suggestions.push({
      kind: "protein",
      title: "Add a protein source to one meal",
      because: `Protein reached target on ${days(proteinG.daysOnTarget, completeDays)}, averaging ${amount(proteinG.average, "g")} against ${amount(proteinG.averageTarget, "g")}.`,
    });
  }

  if (kcal.average !== null && kcal.averageTarget !== null && Math.abs(kcal.average - kcal.averageTarget) > kcal.averageTarget * calorieTolerance) {
    const over = kcal.average > kcal.averageTarget;

    suggestions.push({
      kind: "calories",
      title: over ? "Trim a portion or a snack" : "Add a snack on lighter days",
      because: `They averaged ${amount(kcal.average, "kcal")} against ${amount(kcal.averageTarget, "kcal")}, within ${calorieTolerance * 100}% on ${days(kcal.daysOnTarget, completeDays)}.`,
    });
  }

  return suggestions;
}

function water({ recordedDays, water }: ReviewPeriod): Suggestion[] {
  if (recordedDays.water < minEvidenceDays || water.average === null || water.averageTarget === null || water.daysOnTarget * 2 >= recordedDays.water) return [];

  return [{
    kind: "water",
    title: "Keep water within reach",
    because: `Water reached target on ${days(water.daysOnTarget, recordedDays.water)}, averaging ${amount(water.average, "ml")} against ${amount(water.averageTarget, "ml")}.`,
  }];
}

// Missing nights block any claim about sleep.
function sleep({ recordedDays, sleep }: ReviewPeriod): Suggestion[] {
  if (recordedDays.sleep < minEvidenceDays || sleep.average === null || sleep.averageTarget === null || sleep.average > sleep.averageTarget - sleepShortfallMinutes) return [];

  return [{
    kind: "sleep",
    title: "Aim for an earlier night",
    because: `Sleep averaged ${hours(sleep.average)} over ${recordedDays.sleep} nights, against a target of ${hours(sleep.averageTarget)}.`,
  }];
}

function supplements({ supplements }: ReviewPeriod): Suggestion[] {
  const { stackDays, fullDays } = supplements;

  if (stackDays < minEvidenceDays || fullDays * 2 >= stackDays) return [];

  return [{
    kind: "supplements",
    title: "Take your supplements at the same time each day",
    because: `Every supplement on your list was taken on ${days(fullDays, stackDays)}.`,
  }];
}

// Suggestions for a week, most important first. Each rule reads only what was recorded and says what it rests on.
export function coach(week: ReviewPeriod): Suggestion[] {
  if (week.recordedDays.any === 0) return [];

  return [...food(week), ...water(week), ...sleep(week), ...supplements(week)];
}
