import { everyDay } from "../../../src/meals/contract.js";

// Short names for ISO weekdays 1 to 7.
export const weekdayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const namedDays = new Map([
  [everyDay.join(), { label: "Every day", phrase: "every day" }],
  ["1,2,3,4,5", { label: "Weekdays", phrase: "on weekdays" }],
  ["6,7", { label: "Weekends", phrase: "on weekends" }],
]);

// Weekdays, such as the days a daily meal logs itself on or a supplement is due, as a label ("Weekdays",
// "Mon, Wed, Fri") and as a sentence ends ("on weekdays", "on Mon, Wed, Fri").
export function dailyDays(weekdays: number[]) {
  const sorted = weekdays.toSorted((a, b) => a - b);
  const named = namedDays.get(sorted.join());

  if (named) return named;
  const label = sorted.map((day) => weekdayNames[day - 1]).join(", ");

  return { label, phrase: `on ${label}` };
}
