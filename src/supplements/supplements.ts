import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { supplementIntakes, supplementStacks } from "../db/schema.js";
import type { AppDatabase, Transaction } from "../db/database.js";
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

type When = Pick<IntakeInput, "occurredAt" | "timeZone">;

// Logs supplements at one time, in the order given, all or none. Only what is on that day's stack can be taken; name,
// kind, and dose are copied from it so later edits never rewrite an intake.
async function insertIntakes(tx: Transaction, userId: string, when: When, supplementIds: string[]): Promise<
  { outcome: "created"; entries: SupplementIntake[] } | { outcome: "unknown-reference"; message: string }
> {
  const day = localDate(when.occurredAt, when.timeZone);
  const { supplements } = await getDated(tx, stackKind, userId, day);
  const chosen = [];

  for (const id of supplementIds) {
    const supplement = supplements.find((candidate) => candidate.id === id);

    if (!supplement) return { outcome: "unknown-reference", message: "Supplement is not on your stack for that day" };
    chosen.push(supplement);
  }

  const rows = chosen.map((supplement) => ({
    id: randomUUID(), userId, occurredAt: new Date(when.occurredAt), timeZone: when.timeZone, localDate: day,
    supplementId: supplement.id, name: supplement.name, kind: supplement.kind, dose: supplement.dose,
  }));

  const byId = new Map((await tx.insert(supplementIntakes).values(rows).returning()).map((row) => [row.id, intake(row)]));

  return {
    outcome: "created",
    entries: rows.map(({ id }) => {
      const created = byId.get(id);

      if (!created) throw new Error("Supplement intake insert returned no row");

      return created;
    }),
  };
}

export const intakeRecords: RecordKind<IntakeInput, SupplementIntake> = {
  name: "supplement-intake",
  label: "Supplement intake",
  table: supplementIntakes,
  schema: supplementIntakeSchema,
  create: async (tx, userId, { supplementId, ...when }) => {
    const result = await insertIntakes(tx, userId, when, [supplementId]);

    if (result.outcome !== "created") return result;
    const [entry] = result.entries;

    if (!entry) throw new Error("Supplement intake insert returned no row");

    return { outcome: "created", entry };
  },
};

// Logs several supplements at one time in one transaction, so one missing from the stack logs none of them.
export async function takeSupplements(db: AppDatabase, userId: string, when: When, supplementIds: string[]) {
  return db.transaction((tx) => insertIntakes(tx, userId, when, supplementIds));
}

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
