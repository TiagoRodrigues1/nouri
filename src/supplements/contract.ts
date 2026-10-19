import { z } from "zod";
import { recordBaseSchema } from "../journal/contract.js";
import { isoWeekday, occurredAtSchema, timeZoneSchema } from "../time.js";

export const supplementKinds = ["vitamin", "mineral", "creatine", "omega-3", "other"] as const;

export const doseUnits = ["mg", "mcg", "g", "IU", "ml", "capsule", "tablet", "scoop", "drop"] as const;

export const maxStackSize = 30;

export const maxTimesPerDay = 4;

// ISO weekdays, 1 Monday to 7 Sunday.
const everyDay = [1, 2, 3, 4, 5, 6, 7];

const weekdaysSchema = z.array(z.number().int().min(1).max(7)).min(1).max(7)
  .refine((days) => new Set(days).size === days.length, "Weekdays must be unique");

const timesPerDaySchema = z.number().int().min(1).max(maxTimesPerDay);

// When a supplement is due: on these weekdays, this many times a day. Both default to what every supplement meant
// before schedules, so stacks saved and sent without one still mean once every day.
export const supplementScheduleSchema = z.object({
  weekdays: weekdaysSchema.default(() => [...everyDay]),
  timesPerDay: timesPerDaySchema.default(1),
}).strict();

// A change to a schedule without defaults, so the fields left out keep their value.
export const scheduleChangeSchema = z.object({ weekdays: weekdaysSchema, timesPerDay: timesPerDaySchema }).partial().strict();

export const doseSchema = z.object({
  amount: z.number().positive().max(100_000).refine((value) => Math.abs(value * 1000 - Math.round(value * 1000)) < 1e-7),
  unit: z.enum(doseUnits),
}).strict();

// One line of the stack. The client picks the id, and it stays the same across edits so intakes keep pointing at it.
export const supplementSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(80),
  kind: z.enum(supplementKinds),
  dose: doseSchema,
  schedule: supplementScheduleSchema.default(() => ({ weekdays: [...everyDay], timesPerDay: 1 })),
}).strict();

// The doses of a supplement expected on a date: its times a day on its weekdays, none on other days.
export function dueOn(supplement: Supplement, date: string): number {
  return supplement.schedule.weekdays.includes(isoWeekday(date)) ? supplement.schedule.timesPerDay : 0;
}

// The whole list; saving it replaces the list in force from that day on.
export const supplementStackSchema = z.object({
  supplements: z.array(supplementSchema).max(maxStackSize).refine((supplements) => new Set(supplements.map((supplement) => supplement.id)).size === supplements.length, "Supplement ids must be unique"),
}).strict();

export const stackForDaySchema = z.object({
  // The day this list took effect; null while the person has never saved one.
  effectiveFrom: z.iso.date().nullable(),
  supplements: z.array(supplementSchema),
});

export const intakeInputSchema = z.object({
  occurredAt: occurredAtSchema,
  timeZone: timeZoneSchema,
  supplementId: z.uuid(),
}).strict();

// Name, kind, and dose are copied from the stack when logged, so later edits never rewrite an intake.
export const supplementIntakeSchema = recordBaseSchema.extend({
  supplementId: z.uuid(),
  name: z.string(),
  kind: z.enum(supplementKinds),
  dose: doseSchema,
});

export const supplementDaySchema = z.object({
  // The stack in force on the day, in stack order, each with the doses due that day (0 on an off day) and the
  // intakes logged against it.
  items: z.array(z.object({ supplement: supplementSchema, due: z.number().int().min(0), intakes: z.array(supplementIntakeSchema) })),
  // Intakes whose supplement has since left that day's stack, so they can still be seen and undone.
  unlisted: z.array(supplementIntakeSchema),
});

export type SupplementKind = z.infer<typeof supplementSchema>["kind"];

export type SupplementSchedule = z.infer<typeof supplementScheduleSchema>;

export type Dose = z.infer<typeof doseSchema>;

export type Supplement = z.infer<typeof supplementSchema>;

// A supplement as a stack row holds it: lists saved before schedules have none.
export type StoredSupplement = z.input<typeof supplementSchema>;

export type SupplementStack = z.infer<typeof supplementStackSchema>;

export type StackForDay = z.infer<typeof stackForDaySchema>;

export type IntakeInput = z.infer<typeof intakeInputSchema>;

export type SupplementIntake = z.infer<typeof supplementIntakeSchema>;

export type SupplementDay = z.infer<typeof supplementDaySchema>;
