import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { supplementIntakes, supplementStacks } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { getDated, type DatedKind } from "../effective-dated.js";
import type { RecordKind } from "../journal/records.js";
import { localDate } from "../time.js";
import { stackForDaySchema, supplementIntakeSchema, supplementStackSchema } from "./contract.js";
import type { IntakeInput, StackForDay, SupplementDay, SupplementIntake, SupplementStack } from "./contract.js";

type IntakeRow = typeof supplementIntakes.$inferSelect;

function intake(row: IntakeRow): SupplementIntake {
  return {
    id: row.id,
    revision: row.revision,
    occurredAt: row.occurredAt.toISOString(),
    timeZone: row.timeZone,
    localDate: row.localDate,
    supplementId: row.supplementId,
    name: row.name,
    kind: row.kind,
    dose: row.dose,
  };
}

export const stackKind: DatedKind<typeof supplementStacks, SupplementStack, StackForDay> = {
  table: supplementStacks,
  input: supplementStackSchema,
  schema: stackForDaySchema,
  empty: { effectiveFrom: null, supplements: [] },
  toResult: (row) => ({ effectiveFrom: row.effectiveFrom, supplements: row.supplements }),
  values: (stack) => ({ supplements: stack.supplements }),
};

export const intakeRecords: RecordKind<IntakeInput, SupplementIntake> = {
  name: "supplement-intake",
  label: "Supplement intake",
  table: supplementIntakes,
  schema: supplementIntakeSchema,
  create: async (tx, userId, input) => {
    const day = localDate(input.occurredAt, input.timeZone);
    const { supplements } = await getDated(tx, stackKind, userId, day);
    const supplement = supplements.find((candidate) => candidate.id === input.supplementId);

    // Only what is on that day's stack can be taken; the snapshot below is what the intake keeps.
    if (!supplement) return { outcome: "unknown-reference", message: "Supplement is not on your stack for that day" };

    const [row] = await tx.insert(supplementIntakes).values({
      id: randomUUID(), userId, occurredAt: new Date(input.occurredAt), timeZone: input.timeZone, localDate: day,
      supplementId: supplement.id, name: supplement.name, kind: supplement.kind, dose: supplement.dose,
    }).returning();

    if (!row) throw new Error("Supplement intake insert returned no row");

    return { outcome: "created", entry: intake(row) };
  },
};

export async function getSupplementDay(db: AppDatabase, userId: string, date: string): Promise<SupplementDay> {
  const [stack, rows] = await Promise.all([
    getDated(db, stackKind, userId, date),
    db.select().from(supplementIntakes).where(and(
      eq(supplementIntakes.userId, userId), eq(supplementIntakes.localDate, date), isNull(supplementIntakes.deletedAt),
    )).orderBy(supplementIntakes.occurredAt, supplementIntakes.id),
  ]);

  const intakes = rows.map(intake);
  const listed = new Set(stack.supplements.map((supplement) => supplement.id));

  return {
    items: stack.supplements.map((supplement) => ({ supplement, intakes: intakes.filter((entry) => entry.supplementId === supplement.id) })),
    unlisted: intakes.filter((entry) => !listed.has(entry.supplementId)),
  };
}
