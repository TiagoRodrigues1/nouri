import { z } from "zod";
import { error } from "../http-error.js";

export const idempotencyKeySchema = z.string().min(1).max(200);

// A quoted positive safe integer, just like the revision returned with a journal entry.
export const revisionHeaderSchema = z.string().regex(/^"[1-9][0-9]*"$/)
  .refine((value) => Number.isSafeInteger(Number(value.slice(1, -1))))
  .meta({ description: 'A quoted positive integer no greater than 9007199254740991, for example "1".' });

export function revisionHeader(value: string | undefined): number | null {
  const parsed = revisionHeaderSchema.safeParse(value);

  return parsed.success ? Number(parsed.data.slice(1, -1)) : null;
}

type MutationResult<Entry> =
  | { outcome: "created" | "updated"; entry: Entry }
  | { outcome: "deleted" | "missing" | "stale" | "key-reuse" | "catalog-missing" | "invalid-item" | "invalid-amount" }
  | { outcome: "unknown-reference" | "duplicate"; message: string };

// Every write answers the same way; routes differ only in what a missing record is called. A write that never
// finds a record missing names none.
export function mutationResponse<Entry>(result: MutationResult<Entry>, missing = "Not found"): Response {
  switch (result.outcome) {
    case "created":
    case "updated":
      return new Response(JSON.stringify(result.entry), { status: result.outcome === "created" ? 201 : 200, headers: { "Content-Type": "application/json" } });
    case "deleted":
      return new Response(null, { status: 204 });
    case "missing":
      return error(404, missing);
    case "catalog-missing":
      return error(404, "Catalog food not found");
    case "unknown-reference":
      return error(404, result.message);
    case "invalid-item":
      return error(400, "Invalid saved meal item");
    case "invalid-amount":
      return error(400, "Amount out of range");
    case "duplicate":
      return error(409, result.message);
    case "stale":
      return error(409, "Revision conflict");
    case "key-reuse":
      return error(409, "Idempotency key reused for another request");
  }
}
