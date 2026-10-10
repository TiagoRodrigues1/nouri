# Account deletion, data export, and retention

## Problem

Before real users arrive, Nouri needs to erase a person's records when they delete their account, and to hand over everything it stores about them. [auth-design.md](auth-design.md) deferred both. Clerk owns accounts, so deletion starts there and reaches Nouri as a signed `user.deleted` webhook. Nouri stores records in 16 tables, each with a `user_id` that names a `users.id`. No foreign key enforced that, so a new table could be forgotten by both erasure and export. Retry receipts had no expiry ([food-slice-design.md](food-slice-design.md)), and their bodies copy food entries, so they also needed an age limit.

The constraints were:

- Clerk issues session tokens that stay valid for about a minute, and verifying one needs no network call. A request can arrive after the deletion.
- `/v1` caches each Clerk user's Nouri id in memory, and `userFor` creates a `users` row the first time it sees a Clerk user.
- Google Health refresh tokens are encrypted with `WEARABLE_TOKEN_KEY`. Revoking the grant needs them, so the revoke must happen before the rows are deleted.
- One instance serves Nouri (see the Dockerfile), so nothing coordinates background work across processes.

## Usage (caller's view)

A person deletes their account in Clerk's account panel (**Manage account → Delete account**). Clerk then calls Nouri:

```http
POST /webhooks/clerk
svix-id: … svix-timestamp: … svix-signature: …
{ "type": "user.deleted", "data": { "id": "user_2x…", "deleted": true } }
→ 204
```

To get a copy of their data, the person chooses **Download my data** in the same menu. The API also exposes the export directly:

```http
GET /v1/account/export
→ 200 Content-Disposition: attachment; filename="nouri-export-2026-10-10.json"
{ "format": "nouri-export/1", "exportedAt": "…", "account": { "id": "…", "created_at": "…" },
  "tables": { "food_entries": [{ "id": "…", "name": "Oats", "kcal_milli": "311000", … }], "progress_photos": [{ "image": "<base64>", … }], … } }
```

Server code calls three functions:

```ts
await eraseAccount(db, wearables, clerkUserId);
return new Response(exportAccount(db, userId, new Date()), { headers });
await sweepExpired(db, new Date());
```

## Shape

- **The database decides what belongs to a person.** Migration `0002-account-erasure.sql` adds `FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE` to every table that has a `user_id`. The integration test fails if any `user_id` column lacks one. Erasure, export, and orphan prevention all rely on this one rule (per single source of truth).
- **`src/account/account.ts`** owns the account's data lifecycle:
  - `eraseAccount` revokes each wearable grant, best effort. In one transaction it then records the Clerk id in `erased_users` and deletes the `users` row, and the delete cascades. Running it twice is harmless, which matters because Clerk retries until it gets a 2xx.
  - `exportAccount` returns a streamed response body. It finds the tables through the same foreign keys and reads them in one read-only repeatable-read snapshot. It reads tables with binary columns one row at a time, since a photo row can hold 8 MB. Rows keep their stored columns, binary values become base64, and provider tokens and OAuth secrets are left out.
  - `sweepExpired` deletes receipts older than 30 days, abandoned OAuth states, and `erased_users` rows older than a day.
- **`src/identity/identity.ts`** still holds every Clerk detail. `Identity.readWebhook` checks the Standard Webhooks signature and returns `{ deletedUser }` or `"forged"`. `userFor` now returns `null` for an erased Clerk user, and `/v1` and `/mcp` answer 401 for that user.
- **`src/app.ts`** removes the deleted user's cached id after erasing. A request already holding the stale id fails its foreign key and writes nothing.
- **`src/server.ts`** runs the sweep at startup and then every hour.

The public surface is three functions, one webhook route, and one GET route. Callers don't see the table list, the snapshot, cursor sizes, the redaction list, or the order that revocation and deletion require.

## Synthesis decision

The two candidates differed in what defined a person's data.

1. **Foreign keys with cascade and catalog-driven export** (chosen). The database guarantees that erasure is complete and that no row is left without an owner. Export reads the same constraint, so the two cannot disagree. A new table only needs its foreign key, and the test enforces that.
2. **A TypeScript table registry with per-feature exporters.** Each module would contribute its tables, and export would emit public contract shapes such as `entrySchema`. That gives friendlier JSON, but it spreads the policy across about 15 modules. It also leaves completeness to a list someone must remember to update. Soft-deleted entries and receipts would fall out of the export too, though a right-of-access request must include them.

From candidate 2 I kept the reasoning that the export must leave out secrets that only work with this server's keys (the `withheld` map). The webhook design was settled before comparison: Clerk deletes the account, and Nouri reacts. Adding a Nouri `DELETE /v1/account` that also calls Clerk's API would create a second path to the same outcome.

## Tradeoffs accepted

- The export keeps each table's stored shape, including `kcal_milli` as a string, revisions, and soft-deleted rows. We accept rougher JSON in exchange for completeness with no per-feature code.
- Photos travel inside the JSON as base64, about 33% larger than the files. We accept the size in exchange for one self-contained file and no zip dependency.
- Foreign keys are added `NOT VALID`. Rows written before accounts existed, under an `API_USER_ID` never linked to a Clerk user, are neither checked, exported, nor erased. New writes are always checked.
- Cascade deletes scan tables whose `user_id` indexes are partial (`WHERE deleted_at IS NULL`). Deletions are rare, so we accept a scan per account over extra indexes.
- A retry sent more than 30 days after its first attempt creates a duplicate. The page retries only while it is open. A future offline client must drop queued writes before they reach that age.
- An `erased_users` row keeps the Clerk id for a day after erasure. That is the minimum needed to stop a token from before the erasure from creating a new account.
- `CLERK_WEBHOOK_SIGNING_SECRET` is required only when `NODE_ENV=production`. Locally every webhook is refused, Clerk keeps retrying, and the events succeed once the secret is set.

## Alternatives considered

| Shape | What it hides | Why it lost |
| --- | --- | --- |
| Registry of tables in TypeScript | Table list behind one module | Completeness rests on a list someone must remember. The database can enforce it instead. |
| Per-feature contract-shaped exporters | Storage columns | Spreads export policy across every feature and omits soft-deleted rows and receipts. |
| Zip with JSON plus photo files | Base64 overhead | Adds a dependency and a format writer for a file people rarely open. Worth doing if photo exports get large. |
| Prune receipts inside `withReceipt` | A background timer | Inactive accounts would keep receipts forever, and every write would pay for the cleanup. |

## Open questions and risks

- If Nouri is down for longer than Clerk's retry schedule (about three days), a `user.deleted` event is lost. Should a periodic reconciliation compare `users` with Clerk's user list?
- Database backups still hold erased rows until they expire. What backup retention should the hosted deployment promise?
- Should the sweep also remove soft-deleted entries after a while, or do revisions and undo rely on them?
- More than one app instance would run the sweep more than once. That is harmless, but the timer belongs in a worker once one exists.

## Next implementation step

Set up the Clerk production webhook endpoint for `user.deleted`, set `CLERK_WEBHOOK_SIGNING_SECRET` on the deployment, and turn on **Allow users to delete their accounts** in Clerk.
