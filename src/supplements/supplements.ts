import { randomUUID } from "node:crypto";
import { and, between, eq, isNull } from "drizzle-orm";
import { supplementIntakes, supplementStacks } from "../db/schema.js";
import type { AppDatabase, Transaction } from "../db/database.js";
import { getDated, getDatedHistory, type DatedKind } from "../effective-dated.js";
import { recordEdit, type RecordKind } from "../journal/records.js";
import { localDate, shiftDate } from "../time.js";
import { intakeInputSchema, stackForDaySchema, supplementIntakeSchema, supplementStackSchema } from "./contract.js";
import type { IntakeInput, StackForDay, Supplement, SupplementDay, SupplementIntake, SupplementStack } from "./contract.js";

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

type UnknownSupplement = { outcome: "unknown-reference"; message: string };

// The row values of intakes taken at one time, in the order given. Only what is on that day's stack can be taken;
// name, kind, and dose are copied from it so later edits to the stack never rewrite an intake.
async function intakeValues(tx: Transaction, userId: string, when: When, supplementIds: string[]) {
  const day = localDate(when.occurredAt, when.timeZone);
  const { supplements } = await getDated(tx, stackKind, userId, day);
  const chosen: Supplement[] = [];

  for (const id of supplementIds) {
    const supplement = supplements.find((candidate) => candidate.id === id);

    if (!supplement) return { outcome: "unknown-reference" as const, message: "Supplement is not on your stack for that day" };
    chosen.push(supplement);
  }

  return chosen.map((supplement) => ({
    occurredAt: new Date(when.occurredAt), timeZone: when.timeZone, localDate: day,
    supplementId: supplement.id, name: supplement.name, kind: supplement.kind, dose: supplement.dose,
  }));
}

// Logs supplements at one time, in the order given, all or none.
async function insertIntakes(tx: Transaction, userId: string, when: When, supplementIds: string[]): Promise<
  { outcome: "created"; entries: SupplementIntake[] } | UnknownSupplement
> {
  const values = await intakeValues(tx, userId, when, supplementIds);

  if ("outcome" in values) return values;
  const rows = values.map((value) => ({ id: randomUUID(), userId, ...value }));

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
  // Moving an intake to another day takes that day's stack, as logging it there would.
  edit: recordEdit(supplementIntakes, {
    input: intakeInputSchema,
    inputOf: ({ occurredAt, timeZone, supplementId }) => ({ occurredAt, timeZone, supplementId }),
    entry: intake,
    values: async (tx, userId, { supplementId, ...when }) => {
      const values = await intakeValues(tx, userId, when, [supplementId]);

      return "outcome" in values ? values : values[0] ?? {};
    },
  }),
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

// `taken` counts the day's stack supplements with at least one intake; `intakeCount` also includes unlisted ones.
export type SupplementRangeDay = { intakeCount: number; taken: number; stackSize: number };

// Days from `from` to `to` that have a stack in force or an intake, by local date.
export async function getSupplementRange(db: AppDatabase, userId: string, from: string, to: string): Promise<Map<string, SupplementRangeDay>> {
  const [stackOn, rows] = await Promise.all([
    getDatedHistory(db, stackKind, userId, to),
    db.select({ localDate: supplementIntakes.localDate, supplementId: supplementIntakes.supplementId }).from(supplementIntakes).where(and(
      eq(supplementIntakes.userId, userId), between(supplementIntakes.localDate, from, to), isNull(supplementIntakes.deletedAt),
    )),
  ]);

  const intakes = new Map<string, string[]>();

  for (const row of rows) intakes.set(row.localDate, [...intakes.get(row.localDate) ?? [], row.supplementId]);

  const days = new Map<string, SupplementRangeDay>();

  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const { supplements } = stackOn(date);
    const ids = intakes.get(date) ?? [];

    if (supplements.length === 0 && ids.length === 0) continue;
    days.set(date, { intakeCount: ids.length, taken: supplements.filter((supplement) => ids.includes(supplement.id)).length, stackSize: supplements.length });
  }

  return days;
}
