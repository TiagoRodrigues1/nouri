import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { mutationReceipts } from "../db/schema.js";
import type { AppDatabase, Transaction } from "../db/database.js";

type Receipt = typeof mutationReceipts.$inferSelect;

const storedOutcomeSchema = z.enum(["created", "updated", "deleted", "missing", "stale", "key-reuse"]);

type Result<Entry, Extra extends string> =
  | { outcome: "created" | "updated"; entry: Entry }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" | Extra };

// The callback parses a completed receipt into the feature's narrower result type.
export async function withReceipt<Entry, Extra extends string, R extends Result<Entry, Extra>>(
  db: AppDatabase, userId: string, key: string, requestHash: string,
  parse: (receipt: Receipt) => R,
  run: (tx: Transaction) => Promise<R>, discard?: Extra,
): Promise<R | { outcome: "key-reuse" }> {
  return db.transaction(async (tx) => {
    const where = and(eq(mutationReceipts.userId, userId), eq(mutationReceipts.key, key));
    await tx.insert(mutationReceipts).values({ userId, key, requestHash }).onConflictDoNothing();
    const [receipt] = await tx.select().from(mutationReceipts).where(where).for("update");

    if (!receipt) throw new Error("Receipt missing after insert");

    if (receipt.requestHash !== requestHash) return { outcome: "key-reuse" as const };

    if (receipt.outcome !== null) return parse(receipt);

    const result = await run(tx);

    if (result.outcome === discard) {
      await tx.delete(mutationReceipts).where(where);
    } else {
      const body = "entry" in result ? result.entry : null;
      await tx.update(mutationReceipts).set({ outcome: storedOutcomeSchema.parse(result.outcome), body }).where(where);
    }

    return result;
  });
}
