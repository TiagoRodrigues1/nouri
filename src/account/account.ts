import { eq, lt } from "drizzle-orm";
import type { Row } from "postgres";
import { erasedUsers, mutationReceipts, users, wearableOauthStates } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { connectionFor } from "../wearables/connections.js";
import type { WearableRuntime } from "../wearables/provider.js";

// A retry older than this creates a second record instead of returning the first. The page retries only while
// it stays open; a future offline client must drop queued writes before they reach this age.
export const receiptLifetimeDays = 30;

// Longer than any session token Clerk issued before the erasure stays valid.
const erasedLifetimeDays = 1;

// Secrets that only work with this server's keys. The export keeps their rows without them.
const withheld = new Map([
  ["wearable_connections", ["refresh_token", "access_token"]],
  ["wearable_oauth_states", ["state_hash", "code_verifier"]],
]);

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

// Erases everything Nouri holds for a Clerk user. Wearable grants are revoked with the provider first, while
// their tokens still exist. Deleting the users row then cascades to every table that references it, and the
// erased_users row refuses that Clerk user a new account. Safe to repeat; Clerk retries until it succeeds.
export async function eraseAccount(db: AppDatabase, wearables: WearableRuntime | undefined, clerkUserId: string): Promise<void> {
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.clerkUserId, clerkUserId));

  // A revoke that fails leaves the grant in the person's Google account settings; it must not keep their records here.
  if (user && wearables) {
    for (const provider of wearables.providers) await connectionFor(db, wearables, provider, user.id).disconnect().catch(() => undefined);
  }

  await db.transaction(async (tx) => {
    await tx.insert(erasedUsers).values({ clerkUserId }).onConflictDoNothing();
    await tx.delete(users).where(eq(users.clerkUserId, clerkUserId));
  });
}

function exportRow(row: Row, hidden: string[]): Row {
  const kept: Row = {};

  for (const [column, value] of Object.entries(row)) {
    if (!hidden.includes(column)) kept[column] = Buffer.isBuffer(value) ? value.toString("base64") : value;
  }

  return kept;
}

// Everything stored for the person, as a JSON response body, one table at a time. The tables are the ones whose
// rows deleting the account erases, so the export and the erasure cannot disagree. Rows keep their stored
// columns, and binary columns such as photos are base64. One read-only snapshot covers every table.
export function exportAccount(db: AppDatabase, userId: string, now: Date): ReadableStream<Uint8Array> {
  const pieces = exportPieces(db, userId, now);
  const encoder = new TextEncoder();

  // Reads the next piece only when the client takes the last one, so a slow download never buffers the account.
  return new ReadableStream({
    async pull(controller) {
      const next = await pieces.next();

      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
    async cancel() {
      await pieces.return(undefined);
    },
  });
}

async function* exportPieces(db: AppDatabase, userId: string, now: Date): AsyncGenerator<string> {
  const sql = await db.$client.reserve();

  try {
    await sql`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    await sql`SET LOCAL statement_timeout = '30s'`;
    await sql`SET LOCAL idle_in_transaction_session_timeout = '120s'`;
    const [account] = await sql`SELECT id, created_at FROM users WHERE id = ${userId}`;

    const tables = await sql<{ name: string; binary: boolean }[]>`
      SELECT c.conrelid::regclass::text AS name, EXISTS (
        SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'bytea'::regtype
      ) AS binary
      FROM pg_constraint c WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass ORDER BY name`;

    yield `{"format":"nouri-export/1","exportedAt":${JSON.stringify(now.toISOString())},"account":${JSON.stringify(account ?? null)},"tables":{`;

    for (const [index, table] of tables.entries()) {
      const hidden = withheld.get(table.name) ?? [];
      let separator = "";

      yield `${index === 0 ? "" : ","}${JSON.stringify(table.name)}:[`;

      // A photo row can hold 8 MB, so binary tables are read a row at a time.
      for await (const rows of sql`SELECT * FROM ${sql(table.name)} WHERE user_id = ${userId}`.cursor(table.binary ? 1 : 500)) {
        for (const row of rows) {
          yield separator + JSON.stringify(exportRow(row, hidden));
          separator = ",";
        }
      }

      yield "]";
    }

    yield "}}";
  } finally {
    // Also ends the snapshot when the download stops early, before the connection goes back to the pool.
    await sql`ROLLBACK`.catch(() => undefined);
    sql.release();
  }
}

// Removes what Nouri keeps only for a while: retry receipts, sign-in attempts that were never finished, and
// erased Clerk users whose tokens have all expired. One instance serves Nouri, so the server runs this itself.
export async function sweepExpired(db: AppDatabase, now: Date): Promise<void> {
  await db.delete(mutationReceipts).where(lt(mutationReceipts.createdAt, daysBefore(now, receiptLifetimeDays)));
  await db.delete(wearableOauthStates).where(lt(wearableOauthStates.expiresAt, now));
  await db.delete(erasedUsers).where(lt(erasedUsers.erasedAt, daysBefore(now, erasedLifetimeDays)));
}
