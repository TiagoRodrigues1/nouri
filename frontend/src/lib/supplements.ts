import { format, type SupplementDay, type SupplementIntake, type SupplementKind } from "./api";
import type { Dose } from "../../../src/supplements/contract";
import { clock } from "./time";

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

export const takenAt = (intake: SupplementIntake) => clock.format(new Date(intake.occurredAt));

// What the My Day card and the Overview section both show, so their wording stays the same.
export function checklist(day: SupplementDay) {
  const rows = day.items.map(({ supplement, intakes }) => {
    const last = intakes.at(-1);

    return {
      supplement,
      last,
      timesLabel: intakes.length > 1 ? `${intakes.length}× · ` : "",
      meta: `${doseLabel(supplement.dose)} · ${kindLabels[supplement.kind]}`,
      markLabel: `Mark ${supplement.name} as taken`,
      unmarkLabel: last ? `Unmark ${supplement.name}, taken at ${takenAt(last)}` : "",
    };
  });

  const unlisted = day.unlisted.map((intake) => ({
    intake,
    time: takenAt(intake),
    meta: `${doseLabel(intake.dose)} · no longer on your list`,
    removeLabel: `Remove ${intake.name} taken at ${takenAt(intake)}`,
  }));

  const taken = rows.filter((row) => row.last).length;

  return { rows, unlisted, taken, total: rows.length, empty: rows.length === 0 && unlisted.length === 0 };
}
