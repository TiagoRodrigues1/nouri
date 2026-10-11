import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { AppDatabase, Transaction } from "../db/database.js";
import { requestHash, withReceipt } from "./receipt.js";

export type RecordCommand<Input> =
  | { kind: "create"; input: Input }
  | { kind: "delete"; id: string; revision: number };

export type RecordMutationResult<Entry> =
  | { outcome: "created"; entry: Entry }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" }
  | { outcome: "unknown-reference" | "quota-exceeded"; message: string };

export type RecordKind<Input, Entry> = {
  // Receipts share one key space, so the fingerprint names the record kind.
  name: string;
  label: string;
  table: PgTable;
  schema: z.ZodType<Entry>;
  fingerprint?: (input: Input) => string;
  erase?: SQL;
  deletable?: SQL;
  create: (tx: Transaction, userId: string, input: Input) => Promise<
    { outcome: "created"; entry: Entry } | { outcome: "unknown-reference" | "quota-exceeded"; message: string }
  >;
};

function hash<Input, Entry>(kind: RecordKind<Input, Entry>, command: RecordCommand<Input>): string {
  const request = command.kind === "create"
    ? { kind: `${kind.name}-create`, input: kind.fingerprint ? kind.fingerprint(command.input) : command.input }
    : { ...command, kind: `${kind.name}-delete` };

  return requestHash(request);
}

export type SoftDeleteOptions = { erase?: SQL | undefined; deletable?: SQL | undefined };

export async function softDelete(tx: Transaction, table: PgTable, userId: string, id: string, revision: number, { erase, deletable }: SoftDeleteOptions = {}): Promise<{ outcome: "deleted" | "missing" | "stale" }> {
  const scope = deletable ? sql` AND ${deletable}` : sql``;

  const deleted = await tx.execute(sql`
    UPDATE ${table} SET revision = revision + 1, deleted_at = now(), updated_at = now()${erase ? sql`, ${erase}` : sql``}
    WHERE user_id = ${userId} AND id = ${id} AND revision = ${revision} AND deleted_at IS NULL${scope}
    RETURNING id`);

  if (deleted.length > 0) return { outcome: "deleted" };

  const current = await tx.execute(sql`SELECT id FROM ${table} WHERE user_id = ${userId} AND id = ${id} AND deleted_at IS NULL${scope}`);

  return { outcome: current.length > 0 ? "stale" : "missing" };
}

export async function mutateRecord<Input, Entry>(db: AppDatabase, userId: string, key: string, kind: RecordKind<Input, Entry>, command: RecordCommand<Input>): Promise<RecordMutationResult<Entry>> {
  return withReceipt(db, userId, key, hash(kind, command), (receipt): RecordMutationResult<Entry> => {
    const { outcome, body } = receipt;

    if (outcome === null) throw new Error("Incomplete receipt cannot be replayed");

    if (outcome === "created") return { outcome, entry: kind.schema.parse(body) };

    if (outcome === "updated") throw new Error("Journal records are never updated");

    return { outcome };
  }, async (tx): Promise<RecordMutationResult<Entry>> => {
    if (command.kind === "delete") return softDelete(tx, kind.table, userId, command.id, command.revision, { erase: kind.erase, deletable: kind.deletable });

    return kind.create(tx, userId, command.input);
  });
}
