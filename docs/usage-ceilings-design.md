# Usage ceilings for signed-in accounts and public traffic

Follows up the rate, storage, concurrency, and billing findings in `docs/security-review.md`. PR #41 added the request, photo, and export allowances. Draft PR #44 owns the Google Health sync findings. This change covers the rest.

## Problem

Four gaps remained after PR #41:

- **Public traffic can lock out signed-in people.** The gate counts every request against one instance-wide budget before it knows who sent it. Forged session tokens can use up the 600-per-minute `/v1` check allowance, and anonymous page or asset requests can use up the 3,000 requests per minute and 32 handlers. Valid sessions are then refused too. Session tokens are verified locally since PR #41, so knowing the caller first is cheap. MCP tokens are opaque, so each MCP message asks Clerk's API and looks up the user in the database.
- **Stored records have no ceiling.** Writes are rate-limited, but rows persist and soft deletes keep them. One account writing 500 times a day for a year stores without bound, and so does the whole app.
- **Barcode misses call Open Food Facts every time,** with no allowance per account or for the app.
- **The Google Health OAuth callback queries the database before checking its cookie,** so random `state` values from anyone keep Neon awake.

Constraints: one server instance, in-memory allowances (as in PR #41), no trust in forwarding headers, no new required setting, and writes from HTTP, MCP, daily-meal fills, and imports alike.

## Usage (caller's view)

```ts
// app.ts
const access = accountAccess(db, identity);              // who is calling, and their Nouri user id
const limits = requestPolicy({ identify: access.identify });
app.use(limits.beforeRequest);                           // identifies locally, then admits from the caller's pool

app.use("/v1/*", async (context, next) => {
  const clerkUserId = context.get("clerkUserId");        // set by the gate; never re-verified
  if (!clerkUserId) return error(401, "Unauthorized");
  ...
  const userId = await access.userId(clerkUserId);
});

const foods = rememberedLookups(packagedFoods, limits.barcodeFetch);   // cache + app-wide upstream allowance

app.onError((failure, context) => storageFull(failure) ? error(413, storageFullMessage) : ...);
```

```ts
// mcp/routes.ts: a cached token was identified by the gate; otherwise Clerk is asked once and the answer kept for a minute.
const clerkUserId = context.get("clerkUserId") ?? await access.verifyAgent(context.req.raw);
```

## Shape

**Identify, then admit.** `accountAccess(db, identity)` owns caller identity:

- `identify(request)` is local only. It verifies a session JWT on `/v1/*`, or finds a cached MCP token on `/mcp`. Otherwise it returns null.
- `verifyAgent(request)` makes the remote Clerk check and caches a SHA-256 of the token for 60 seconds, holding at most 1,000 tokens.
- `userId(clerkUserId)` keeps the Clerk-to-Nouri id cache that app.ts used to hold, now shared with MCP.
- `forget(clerkUserId)` runs on erasure.

The gate (`requestLimits`) receives `identify` and puts the result in the context. At most 32 requests can be waiting on identification at once, because a signing-key refresh can hold them for up to five seconds before any other counter sees them. Identified requests draw from a separate 3,000-per-minute pool. Each account's 180-per-minute share is reserved together with that pool, so an account past its share is refused without draining the pool for others. Signed-in requests always have 8 of the 32 handlers. Anonymous requests keep the old 3,000-per-minute budget. Anonymous requests that reach the database or Clerk (`/v1`, `/mcp`, webhooks, OAuth) can occupy at most 24 handlers. The page and its files take milliseconds and may use all 32. No one signed-in person may hold more than 8 handlers with requests that have a body, so slow uploads from one account cannot fill the rest. Reads are not counted, because a sender cannot make a read slow, and the photo grid fetches every thumbnail at once. The first sketch capped every anonymous request, and the integration test that loads every lazy chunk at once caught it refusing assets. On `/v1`, only failed identifications count against the 600-per-minute session check allowance. On `/mcp`, only uncached tokens count against the 60 remote checks per minute. Per-account allowances (`forUser`) are unchanged. *Per deep-modules:* callers see one context value and never pick a pool.

**Stored-bytes ledger in PostgreSQL.** Migration `0010-account-storage.sql` adds `account_storage (user_id, bytes)`. One row trigger function, attached to every table people fill, adds `pg_column_size(NEW)` and subtracts `pg_column_size(OLD)`. It raises SQLSTATE `53Q01` when an insert, or an update that grows its row, takes the account past 128 MiB or the app past 2 GiB. Updates that do not grow a row, soft deletes (which add a `deleted_at` timestamp), and deletes never raise, so a full account can still edit and delete. `pg_column_size` of a row value includes values stored out of line in TOAST, because forming the row value inlines them. The check is transactional and survives restarts. The account's ledger row lock serializes that account's concurrent inserts. It covers every write path without any feature calling it (*per fix-root-causes*). Rows left without an owner, such as community foods whose author erased their account, move to a one-row `unowned_storage` total that still counts app-wide. The migration backfills current usage. Photos keep their own quota, and retry receipts and OAuth states expire, so none of them are tracked. A test fails when a new table with `user_id` is neither tracked nor listed as excluded.

`src/account/storage.ts` exports `storageFull(failure)` and the two limits. `app.onError` maps the error to 413. Daily-meal fills during reads skip filling when the account is full instead of failing the read.

**Barcode lookups.** `rememberedLookups(foods, allowFetch)` keeps found products for a day and misses for six hours, holding at most 5,000 barcodes. Upstream failures are not kept. Fetches past the app-wide allowance (600 an hour) answer `unavailable`. Each account may make 120 barcode lookups an hour, counted in `forUser`.

**OAuth callback.** The state is compared with the browser's cookie before any lookup.

**Request deadline.** The Node server stops reading a request after 120 seconds, so slow uploads cannot hold handlers indefinitely.

## Synthesis decision

Candidates for the public-traffic gap:

- (A) Identify before admitting, with separate pools.
- (B) Per-IP pre-authentication limits behind a configured count of trusted proxy hops.
- (C) Reserve handlers for requests that carry any bearer header.

C was rejected because an attacker can add a header. B depends on proxy behavior nobody has verified, and a wrong hop count lets callers spoof their IP. A needs no configuration, and B can still be added on top later. A wins.

Candidates for storage:

- (A) The trigger ledger.
- (B) An app-level `reserve(tx, userId, bytes)` called from every write path.
- (C) The hourly sweep measures each account, and writes are refused in memory once it is over.
- (D) Ceilings on active rows per kind.

B leaks into every feature, and imports or new routes forget it. C lags an hour, and it scans every table each hour. D misses soft-deleted rows and grows a policy per kind. A hides everything behind one SQLSTATE and wins.

## Tradeoffs accepted

- We accept that a revoked MCP token keeps working for up to 60 seconds. In exchange, a busy agent sends Clerk one check a minute instead of one per message.
- We accept that the app-wide ceiling is approximate. Concurrent inserts by different accounts cannot see each other's uncommitted bytes, so the total can pass 2 GiB by what in-flight transactions add: a few MB at most, given 32 handlers and schema-bounded rows. In exchange, accounts never wait on each other. A shared lock would serialize every insert in the app, imports included. Each account's own ceiling is exact, because its ledger row is locked.
- We accept limits fixed in SQL. Changing them takes a migration, but they cannot drift between processes or restarts.
- We accept that soft deletes do not free ledger bytes, because the rows still exist. A full account stays full until records are hard-erased. That only happens when the account is erased.
- We accept that a Google Health import that would pass the ceiling fails like any other sync failure.
- We accept that receipts (bounded by write rate times 30 days) sit outside the ledger, so a full account can still delete and retry.

## Alternatives considered

Covered under Synthesis decision. Database `statement_timeout` and `idle_in_transaction_session_timeout` were also considered. They are left to the deploy's `DATABASE_URL` or role settings, because Neon's pooler may refuse startup parameters, and an unverified pooler should not risk a failed start.

## Open questions and risks

- Is 128 MiB per account (about 14 years of heavy logging at roughly 500-byte rows) and 2 GiB app-wide right for the Neon plan in use?
- Should a full account get a visible notice in the web app beyond the 413 error message?

## Next implementation step

Write `accountAccess` and switch the gate and the `/v1` and `/mcp` handlers to the context value.
