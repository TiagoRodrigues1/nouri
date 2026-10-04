import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { mutationReceipts } from "../db/schema.js";
import type { AppDatabase, Transaction } from "../db/database.js";

type Receipt = typeof mutationReceipts.$inferSelect;

const storedOutcomeSchema = z.enum(["created", "updated", "deleted", "missing", "stale", "key-reuse"]);

// The callback parses a completed receipt into the feature's narrower result type. A feature's own
// outcomes (a missing catalog food, an invalid item) keep no receipt, so the key can be sent again once fixed.
export async function withReceipt<R extends { outcome: string }>(
  db: AppDatabase, userId: string, key: string, requestHash: string,
  parse: (receipt: Receipt) => R,
  run: (tx: Transaction) => Promise<R>,
): Promise<R | { outcome: "key-reuse" }> {
  return db.transaction(async (tx) => {
    const where = and(eq(mutationReceipts.userId, userId), eq(mutationReceipts.key, key));
    await tx.insert(mutationReceipts).values({ userId, key, requestHash }).onConflictDoNothing();
    const [receipt] = await tx.select().from(mutationReceipts).where(where).for("update");

    if (!receipt) throw new Error("Receipt missing after insert");

    if (receipt.requestHash !== requestHash) return { outcome: "key-reuse" as const };

    if (receipt.outcome !== null) return parse(receipt);

    const result = await run(tx);
    const stored = storedOutcomeSchema.safeParse(result.outcome);

    if (!stored.success) {
      await tx.delete(mutationReceipts).where(where);
    } else {
      const body = "entry" in result ? result.entry : null;
      await tx.update(mutationReceipts).set({ outcome: stored.data, body }).where(where);
    }

    return result;
  });
}
