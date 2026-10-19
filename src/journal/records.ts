import { and, eq, isNull, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { AppDatabase, Transaction } from "../db/database.js";
import { requestHash, withReceipt } from "./receipt.js";

export type RecordCommand<Input> =
  | { kind: "create"; input: Input }
  | { kind: "edit"; id: string; revision: number; input: Input }
  | { kind: "delete"; id: string; revision: number };

export type RecordMutationResult<Entry> =
  | { outcome: "created" | "updated"; entry: Entry }
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
  // Rows outside it are imported, so neither deleted nor edited here.
  deletable?: SQL;
  // Kinds that can be changed in place, keeping their id.
  edit?: RecordEdit<Input, Entry>;
  create: (tx: Transaction, userId: string, input: Input) => Promise<
    { outcome: "created"; entry: Entry } | { outcome: "unknown-reference" | "quota-exceeded"; message: string }
  >;
};

type UnknownReference = { outcome: "unknown-reference"; message: string };

// Changes an entry in place: the input that would create it now, and how to lock and rewrite its row.
export type RecordEdit<Input, Entry> = {
  input: z.ZodType<Input>;
  inputOf: (entry: Entry) => Input;
  lock: (tx: Transaction, userId: string, id: string, scope: SQL | undefined) => Promise<Entry | null>;
  update: (tx: Transaction, userId: string, id: string, input: Input) => Promise<{ outcome: "updated"; entry: Entry } | UnknownReference>;
};

export type JournalTable = PgTable & { id: PgColumn; userId: PgColumn; revision: PgColumn; deletedAt: PgColumn; updatedAt: PgColumn };

// An edit for a journal table, from the row values an input sets: the same values its create inserts.
export function recordEdit<T extends JournalTable, Input, Entry>(table: T, options: {
  input: z.ZodType<Input>;
  inputOf: (entry: Entry) => Input;
  entry: (row: T["$inferSelect"]) => Entry;
  values: (tx: Transaction, userId: string, input: Input) => Promise<Partial<T["$inferInsert"]> | UnknownReference>;
}): RecordEdit<Input, Entry> {
  const owned = (userId: string, id: string, scope?: SQL) => and(eq(table.userId, userId), eq(table.id, id), isNull(table.deletedAt), scope);
  // Drizzle cannot type a query over a generic table, so it queries the table as any table.
  const source: PgTable = table;

  return {
    input: options.input,
    inputOf: options.inputOf,
    lock: async (tx, userId, id, scope) => {
      const [row] = await tx.select().from(source).where(owned(userId, id, scope)).for("update");

      // SAFETY: source is the table T, and select() reads every column, so the row is T's row.
      return row ? options.entry(row as T["$inferSelect"]) : null;
    },
    update: async (tx, userId, id, input) => {
      const values = await options.values(tx, userId, input);

      if ("outcome" in values) return values;
      const [row] = await tx.update(source).set({ ...values, revision: sql`${table.revision} + 1`, updatedAt: new Date() }).where(owned(userId, id)).returning();

      if (!row) throw new Error("Journal record update returned no row");

      // SAFETY: source is the table T, and returning() reads every column, so the row is T's row.
      return { outcome: "updated", entry: options.entry(row as T["$inferSelect"]) };
    },
  };
}

export type RecordEditResult<Entry> =
  | { outcome: "updated"; entry: Entry }
  | { outcome: "missing" | "imported" }
  | { outcome: "invalid" | "unknown-reference"; message: string };

// Rewrites an entry from its current input, changed by the caller, and checks the result as a create would. The row
// is locked while it changes, so no revision is needed. Like editFood, it keeps no receipt: each call is one attempt.
export async function editRecord<Input, Entry>(db: AppDatabase, userId: string, kind: RecordKind<Input, Entry>, id: string, change: (current: Input) => Input): Promise<RecordEditResult<Entry>> {
  const { edit } = kind;

  if (!edit) throw new Error(`${kind.label} cannot be edited`);

  return db.transaction(async (tx): Promise<RecordEditResult<Entry>> => {
    const current = await edit.lock(tx, userId, id, kind.deletable);

    if (!current) {
      const stored = kind.deletable ? await tx.execute(sql`SELECT id FROM ${kind.table} WHERE user_id = ${userId} AND id = ${id} AND deleted_at IS NULL`) : [];

      return { outcome: stored.length > 0 ? "imported" : "missing" };
    }

    const input = edit.input.safeParse(change(edit.inputOf(current)));

    if (!input.success) return { outcome: "invalid", message: input.error.issues.map((issue) => issue.message).join(" ") };

    return edit.update(tx, userId, id, input.data);
  });
}

function hash<Input, Entry>(kind: RecordKind<Input, Entry>, command: RecordCommand<Input>): string {
  const request = command.kind === "create"
    ? { kind: `${kind.name}-create`, input: kind.fingerprint ? kind.fingerprint(command.input) : command.input }
    : { ...command, kind: `${kind.name}-${command.kind}` };

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

    if (outcome === "created" || outcome === "updated") return { outcome, entry: kind.schema.parse(body) };

    return { outcome };
  }, async (tx): Promise<RecordMutationResult<Entry>> => {
    if (command.kind === "delete") return softDelete(tx, kind.table, userId, command.id, command.revision, { erase: kind.erase, deletable: kind.deletable });

    if (command.kind === "edit") return replace(tx, userId, kind, command);

    return kind.create(tx, userId, command.input);
  });
}

// Rewrites an entry whole at the revision the caller last read. Imported rows are out of scope, so they read as missing.
async function replace<Input, Entry>(tx: Transaction, userId: string, kind: RecordKind<Input, Entry>, { id, revision, input }: { id: string; revision: number; input: Input }): Promise<RecordMutationResult<Entry>> {
  const { edit } = kind;

  if (!edit) throw new Error(`${kind.label} cannot be edited`);

  const current = await edit.lock(tx, userId, id, and(kind.deletable, sql`revision = ${revision}`));

  if (!current) {
    const stored = await tx.execute(sql`SELECT id FROM ${kind.table} WHERE user_id = ${userId} AND id = ${id} AND deleted_at IS NULL${kind.deletable ? sql` AND ${kind.deletable}` : sql``}`);

    return { outcome: stored.length > 0 ? "stale" : "missing" };
  }

  return edit.update(tx, userId, id, input);
}
