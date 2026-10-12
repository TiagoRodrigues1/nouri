import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { AppDatabase, Transaction } from "../db/database.js";
import { workoutRoutines } from "../db/schema.js";
import { softDelete } from "../journal/records.js";
import { requestHash, withReceipt } from "../journal/receipt.js";
import { routineSchema } from "./contract.js";
import type { Routine, RoutineInput, RoutineList } from "./contract.js";

export type RoutineCommand =
  | { kind: "create"; input: RoutineInput }
  | { kind: "edit"; id: string; revision: number; input: RoutineInput }
  | { kind: "delete"; id: string; revision: number };

export type RoutineMutationResult =
  | { outcome: "created" | "updated"; entry: Routine }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" };

type RoutineRow = typeof workoutRoutines.$inferSelect;

function routine(row: RoutineRow): Routine {
  return { id: row.id, revision: row.revision, name: row.name, exercises: row.exercises };
}

// Receipts share one key space, so the fingerprint names routines.
function hash(command: RoutineCommand): string {
  return requestHash({ ...command, kind: `routine-${command.kind}` });
}

async function editRoutine(tx: Transaction, userId: string, id: string, revision: number, input: RoutineInput): Promise<RoutineMutationResult> {
  const [row] = await tx.select().from(workoutRoutines)
    .where(and(eq(workoutRoutines.userId, userId), eq(workoutRoutines.id, id), isNull(workoutRoutines.deletedAt))).for("update");

  if (!row) return { outcome: "missing" };

  if (row.revision !== revision) return { outcome: "stale" };

  const [updated] = await tx.update(workoutRoutines)
    .set({ name: input.name, exercises: input.exercises, revision: sql`${workoutRoutines.revision} + 1`, updatedAt: new Date() })
    .where(eq(workoutRoutines.id, row.id)).returning();

  if (!updated) throw new Error("Routine update returned no row");

  return { outcome: "updated", entry: routine(updated) };
}

export async function listRoutines(db: AppDatabase, userId: string): Promise<RoutineList> {
  const rows = await db.select().from(workoutRoutines)
    .where(and(eq(workoutRoutines.userId, userId), isNull(workoutRoutines.deletedAt)))
    .orderBy(desc(workoutRoutines.createdAt), workoutRoutines.id);

  return { routines: rows.map(routine) };
}

// Exercise names are not checked against the library, as in workouts: a custom exercise deleted later must not
// make a routine invalid.
export async function mutateRoutine(db: AppDatabase, userId: string, key: string, command: RoutineCommand): Promise<RoutineMutationResult> {
  return withReceipt(db, userId, key, hash(command), (receipt): RoutineMutationResult => {
    const { outcome, body } = receipt;

    if (outcome === null) throw new Error("Routine receipt cannot be replayed");

    if (outcome === "created" || outcome === "updated") return { outcome, entry: routineSchema.parse(body) };

    return { outcome };
  }, async (tx): Promise<RoutineMutationResult> => {
    if (command.kind === "delete") return softDelete(tx, workoutRoutines, userId, command.id, command.revision);

    if (command.kind === "edit") return editRoutine(tx, userId, command.id, command.revision, command.input);

    const [row] = await tx.insert(workoutRoutines).values({ id: randomUUID(), userId, name: command.input.name, exercises: command.input.exercises }).returning();

    if (!row) throw new Error("Routine insert returned no row");

    return { outcome: "created", entry: routine(row) };
  });
}
