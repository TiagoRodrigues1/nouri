import { z } from "zod";
import { mib } from "../request-limits.js";

// db/migrations/0011-account-storage.sql enforces these when a row is added; they are here for tests and docs.
export const maxAccountRecordBytes = 128 * mib;

export const maxTotalRecordBytes = 2048 * mib;

export const storageFullMessage = "This account has reached its storage allowance. Nothing new can be saved.";

// The SQLSTATE the ledger raises. Drizzle wraps driver errors, so the cause is checked too.
const ledgerRefusal = z.object({ code: z.literal("53Q01") });

const wrappedRefusal = z.object({ cause: ledgerRefusal });

export function storageFull(failure: Error): boolean {
  return ledgerRefusal.safeParse(failure).success || wrappedRefusal.safeParse(failure).success;
}
