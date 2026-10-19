import { format, type SupplementDay, type SupplementIntake, type SupplementKind } from "./api";
import type { Dose, SupplementSchedule } from "../../../src/supplements/contract";
import { clock } from "./time";
import { dailyDays } from "./weekdays";

export const kindLabels: Record<SupplementKind, string> = {
  vitamin: "Vitamin",
  mineral: "Mineral",
  creatine: "Creatine",
  "omega-3": "Omega-3",
  other: "Other",
};

// Counted units read as words, so "2 capsules" rather than "2 capsule".
const countable: Partial<Record<Dose["unit"], string>> = { capsule: "capsules", tablet: "tablets", scoop: "scoops", drop: "drops" };

export function doseLabel({ amount, unit }: Dose): string {
  return `${format(amount, 3)} ${amount === 1 ? unit : countable[unit] ?? unit}`;
}

// How a schedule reads beside a supplement ("2× a day", "Mon, Thu"); empty for once every day.
export function scheduleLabel({ weekdays, timesPerDay }: SupplementSchedule): string {
  const days = dailyDays(weekdays).label;

  return [days === "Every day" ? "" : days, timesPerDay > 1 ? `${timesPerDay}× a day` : ""].filter(Boolean).join(" · ");
}

export const takenAt = (intake: SupplementIntake) => clock.format(new Date(intake.occurredAt));

// What the My Day card and the Overview section both show, so their wording stays the same.
export function checklist(day: SupplementDay) {
  const rows = day.items.map(({ supplement, due, intakes }) => {
    const last = intakes.at(-1);
    const schedule = scheduleLabel(supplement.schedule);

    return {
      supplement,
      last,
      // Not due on this day; it can still be taken, and stays out of the count.
      offDay: due === 0,
      complete: due > 0 && intakes.length >= due,
      // While doses remain, the next one can be ticked beside the latest.
      dosesLeft: Math.max(due - intakes.length, 0),
      timesLabel: due > 1 ? `${Math.min(intakes.length, due)} of ${due} · ` : intakes.length > 1 ? `${intakes.length}× · ` : "",
      meta: [doseLabel(supplement.dose), ...due === 0 ? [`not due · ${schedule}`] : [kindLabels[supplement.kind], schedule]].filter(Boolean).join(" · "),
      markLabel: last ? `Mark another ${supplement.name} as taken` : `Mark ${supplement.name} as taken`,
      unmarkLabel: last ? `Unmark ${supplement.name}, taken at ${takenAt(last)}` : "",
    };
  });

  const unlisted = day.unlisted.map((intake) => ({
    intake,
    time: takenAt(intake),
    meta: `${doseLabel(intake.dose)} · no longer on your list`,
    removeLabel: `Remove ${intake.name} taken at ${takenAt(intake)}`,
  }));

  const taken = rows.filter((row) => row.complete).length;

  return { rows, unlisted, taken, total: rows.filter((row) => !row.offDay).length, empty: rows.length === 0 && unlisted.length === 0 };
}
