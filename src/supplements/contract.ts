import { z } from "zod";
import { recordBaseSchema } from "../journal/contract.js";
import { occurredAtSchema, timeZoneSchema } from "../time.js";

export const supplementKinds = ["vitamin", "mineral", "creatine", "omega-3", "other"] as const;

export const doseUnits = ["mg", "mcg", "g", "IU", "ml", "capsule", "tablet", "scoop", "drop"] as const;

export const maxStackSize = 30;

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
}).strict();

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
  // The stack in force on the day, in stack order, each with the intakes logged against it.
  items: z.array(z.object({ supplement: supplementSchema, intakes: z.array(supplementIntakeSchema) })),
  // Intakes whose supplement has since left that day's stack, so they can still be seen and undone.
  unlisted: z.array(supplementIntakeSchema),
});

export type SupplementKind = z.infer<typeof supplementSchema>["kind"];

export type Dose = z.infer<typeof doseSchema>;

export type Supplement = z.infer<typeof supplementSchema>;

export type SupplementStack = z.infer<typeof supplementStackSchema>;

export type StackForDay = z.infer<typeof stackForDaySchema>;

export type IntakeInput = z.infer<typeof intakeInputSchema>;

export type SupplementIntake = z.infer<typeof supplementIntakeSchema>;

export type SupplementDay = z.infer<typeof supplementDaySchema>;
