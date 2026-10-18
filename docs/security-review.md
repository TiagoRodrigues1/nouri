# Security and billing review

Reviewed on 2026-10-11 against the local working tree.

The authentication and ownership controls tested successfully. The app does not yet provide adequate protection against usage abuse. Google sign-in proves an identity; it does not restrict that identity's resource consumption. A hard-to-guess hostname is not an access control.

The initial review covered source, installed dependencies, and local tests. The subsequent invite-only change verified the deployed URL and Clerk production access mode. Application protections were then implemented locally as described below. Proxy rules, enabled Google services, billing plans, quotas, database permissions, and deployed revision remain unverified.

## Invite-only access applied

On 2026-10-11, after the user's request, Clerk production access for `https://nouri-tiago-app.dynv6.net/` was changed from `public` to `restricted`, which Clerk labels Invite-only. The production instance was matched to the publishable key served by the deployed page before making the change. A config readback and the live Clerk `/v1/environment` endpoint both confirmed `restricted`. Unauthenticated requests to deployed `/v1/dashboard` and `/mcp` returned 401.

Existing accounts were not deleted or revoked, and Google sign-in settings were not changed. New self-registration now requires an invitation. No invitations were sent. The initial rate, storage, concurrency, and provider billing findings still apply to permitted accounts and public traffic. The local verification helper uses a development instance, so it cannot verify this production-only Clerk setting.

## Code protections implemented locally

At the user's request, the Clerk request amplification, photo storage/download abuse, and general request-limit findings have been addressed in the working tree. Google Health sync changes belong to the separate thread. The findings below describe the original reviewed behavior, not the new implementation.

Session verification now uses local public keys. By default, the server fetches its configured Clerk instance's public JWKS at most once every five minutes, shares concurrent refreshes, and waits at least a minute after failures. Untrusted token key ids cannot trigger additional refreshes. Invalid algorithms, oversized tokens, and unknown keys are refused. An optional `CLERK_JWT_KEY` PEM makes session verification entirely networkless. Key rotation may temporarily refuse a new signing key until the timed refresh; a fixed PEM must be updated when its key changes. MCP opaque-token checks remain remote, with a limit before authentication.

Photo storage checks count originals and thumbnails and run inside the creation transaction under a shared PostgreSQL advisory lock. They therefore survive restarts and cannot be bypassed by concurrent uploads. Existing photos remain readable; accounts already above their storage allowance must delete photos before uploading more. Retries replay their original receipt, and deleting photos frees their active storage allowance.

| Protection | Default |
| --- | --- |
| Account photo storage | 256 MiB, at most 250 active photos |
| App-wide photo storage | 1 GiB of active originals and thumbnails |
| Photo uploads | 20 per account per hour; two uploads active across the instance |
| Photo reads | 60 per account per minute; 1,000 per day |
| Photo download bytes | 512 MiB per account per day; 2 GiB app-wide per day |
| All HTTP requests | 3,000 per minute; at most 32 handlers active |
| Session API requests before authentication | 600 per minute across the instance |
| MCP requests before authentication | 60 per minute across the instance; one message per request |
| Authenticated requests | 180 per account per minute |
| Writes, including PUT and MCP messages | 120 per account per hour; 500 per account per day; 5,000 app-wide per day |
| General request bodies | 256 KiB; photo uploads retain their existing larger allowance |
| Authorization header | 16 KiB |
| Account exports | One active per account, two active globally; one per minute and three per day per account; twenty per day globally |
| Each export | 120-second duration and 512 MiB output limit; 30-second SQL statement timeout |
| Successful response body traffic, including public assets | 4 GiB per day; 20 GiB per 30-day period across the instance |

Related write, feature, bandwidth, and export allowances are checked together and committed only when every allowance permits admission. Rejected account writes cannot drain the shared write quota. Request-attempt limits still count rejected attempts. The shared limiter owns counters and process resources; photo policy lives in `src/photos/limits.ts`, route policy is composed in `src/request-policy.ts`, and export admission and stream cleanup are owned by `src/account/export-limits.ts`. Session authentication requires a signing-key resolver.

Rate and bandwidth windows are held in bounded process memory and restart with the server. Run a single instance as documented for Nouri; multiple instances multiply these limits. Daily and 30-day periods begin when their first request arrives. These are usage guardrails, not provider-enforced billing caps. A response that exceeds its byte allowance is interrupted, and an interrupted export must be retried after its allowance resets. Photo bytes are reserved from metadata before fetching the stored image, so thumbnails consume their actual size and legacy thumbnail fallbacks consume the full image size.

The implementation does not trust forwarded IP headers. Instance-wide limits bound anonymous work even without a trusted proxy address. They can still be exhausted to deny legitimate requests; an upstream WAF and verified provider billing settings remain useful. There is no new database migration or mandatory environment setting for these fixes, and this thread has not deployed them.

Verification includes forged JWT bursts and key rotation/outage behavior; spoofed forwarding headers; body, concurrency, write, photo-byte and export limits; simultaneous uploads competing for the last quota slot; retry replay at a full quota; and freeing storage through deletion. Real Clerk sign-in, photo upload/open/delete, API readback, and account export were also checked through an isolated local verification run. Screenshots and the test-account export are under `/tmp/nouri-verification-evidence/security-billing-20261011`.

Final checks passed: all 57 unit tests, the focused app/account/overview/MCP/photo-quota integration tests, type checking, lint, and the frontend production build. After the final upload-concurrency and MCP changes, the affected photo-quota and MCP integration tests were rerun successfully. The isolated browser run was cleaned up, including its temporary Clerk user and PostgreSQL container. Concurrent work in the other thread changed wearable files and rebuilt frontend assets; the browser run was restarted against the current build before completing photo/export checks.

## Remaining usage findings addressed

On 2026-10-18 the remaining rate, storage, concurrency, and billing findings for signed-in accounts and public traffic were addressed. Google Health sync remains with draft PR #44. The design is in `docs/usage-ceilings-design.md`.

- **Anonymous traffic no longer locks out signed-in people.** The request gate verifies session tokens locally before admitting a request. Identified requests use their own 3,000-per-minute pool and per-account allowances. Only failed sessions count against the 600-per-minute check allowance. Anonymous API, MCP, webhook, and OAuth requests may hold 24 of the 32 handlers. The page and its files may use all of them.
- **MCP tokens Clerk confirmed are remembered for a minute,** with at most 1,000 kept. Repeat messages skip Clerk's API and the user lookup, and only unknown tokens count against the 60 remote checks per minute. A revoked token keeps working for up to that minute.
- **Stored records have ceilings that survive restarts.** A trigger ledger (`account_storage`, migration `0010`) counts the row bytes of every table people fill, whichever path wrote them. New rows are refused with 413 past 128 MiB per account or 2 GiB for the app. An edit that grows a row past a ceiling is refused too. Edits that do not grow a row, and deletions, are always allowed. Soft deletes keep their rows, so they free nothing. Daily-meal fills on a full account are skipped until there is room. Photos keep their own quota, and receipts and sign-in states expire.
- **Barcode lookups are cached.** Products are kept for a day and misses for six hours, at most 5,000 barcodes. Each account may make 120 lookups an hour, and the app sends Open Food Facts at most 600 requests an hour.
- **The Google Health callback checks its cookie before any database query,** so random `state` values no longer reach Neon.
- **Requests that take longer than 120 seconds to arrive are dropped,** and their handlers freed.

Database `statement_timeout`, `lock_timeout`, and `idle_in_transaction_session_timeout` are still unset for the runtime pool. Startup parameters may be refused by Neon's pooler, so set them on the runtime role, or in `DATABASE_URL` once the endpoint accepts them. Allowances other than storage still live in process memory and restart with the server.

## Findings

### High: rejected requests can cause Clerk API calls

`src/identity/identity.ts:27` verifies session tokens using a secret key and remote JWKS. The installed Clerk SDK fetches keys when a token names an unknown signing-key id, even when its key cache is warm. There is no request limiter before authentication in `src/app.ts`.

A local reproduction replaced fetch before importing Clerk, supplied a mock JWKS, and sent three forged JWTs with different unknown key ids. All three tokens were rejected, but they triggered three mocked Clerk fetches. This requires no valid account. The final reproduction made no external requests.

`src/identity/identity.ts:42` also verifies MCP OAuth tokens through Clerk's API. `/mcp` is mounted publicly in `src/mcp/routes.ts`, without a limiter before verification. Valid MCP messages also run `userFor` on every request, adding database work.

Impact: backend API quota exhaustion, slower sign-in, Render work, and possible plan-dependent usage costs. This does not mean Clerk bills per token-verification request.

Fix: limit requests before authentication at a trusted proxy and in the app; support Clerk's public JWT verification key for local session verification, with a rotation procedure. If MCP is unused, disable the endpoint and Clerk dynamic client registration. If used, separately bound token verification and authenticated tool requests. Do not blindly trust client-supplied forwarding headers for IP limits.

### High: unlimited photo storage and downloads

`src/app.ts:330` limits each upload to 8 MiB plus a bounded thumbnail, but `src/photos/photos.ts` inserts bytes into PostgreSQL without an account-wide quota or upload rate limit. A user can send fresh idempotency keys to create unlimited photos. Image signatures validate format prefixes, not actual image structure.

An account uploading 1,000 maximum-sized images stores about 7.8 GiB before thumbnails, WAL, and database overhead. Repeated image reads and full account exports transfer the same bytes again. This is arithmetic, not a load test.

Impact: Neon storage, compute, and transfer usage; Render bandwidth and memory pressure. Export encodes images as base64, expanding their uncompressed representation by about one third.

Fix: enforce cumulative photo byte and count quotas transactionally, plus upload and download rates. Set a global storage ceiling as well if registration is public. Consider bounded image decoding/resizing and object storage with its own quotas. Apply equivalent limits to HTTP and MCP writes.

### High: no general request, write, or concurrency limits

There is no app-level rate limiter, global in-flight request limit, or per-account record ceiling. Valid users can repeatedly create journal records, saved meals, exercises, community foods, and retry receipts. Idempotency prevents duplicate retries using the same key; it does not stop intentional writes with new keys. Receipts expire after 30 days, while most records persist.

Public assets also consume hosting bandwidth without authentication. Cache headers help normal browsers but do not prevent repeated origin requests. Random-state requests to `/oauth/google-health/callback` execute a database lookup before checking the browser cookie, allowing unauthenticated Neon activity. An attacker can keep the database active regardless of scale-to-zero settings.

Fix: combine a proxy/WAF with per-IP pre-authentication limits, per-user rates, expensive-operation limits, account quotas, and global concurrency ceilings. Ensure the Render default hostname cannot bypass any custom-domain proxy protection. Rate limits alone do not cap cumulative monthly costs.

### Medium: syncs repeat expensive upstream reads

`src/wearables/routes.ts:90` invokes sync on every authenticated request. `src/wearables/connections.ts` pulls provider data before acquiring its transaction lock. The lock serializes database changes but does not stop parallel upstream reads. There is no cooldown or shared in-flight sync.

Google imports have a 30-day window, 20-second request timeouts, and a maximum of 40 pages per paginated read. These are useful bounds, but repeated sync requests multiply them. Barcode misses also call Open Food Facts again without a cache.

Fix: allow one in-flight sync per user/provider, enforce a server-side cooldown and daily allowance before upstream calls, bound total sync duration, and cache barcode results and misses. Keep a provider-wide request allowance to protect shared quotas.

### Medium: most request bodies have no byte limit

Only photo uploads use `bodyLimit`. JSON routes, `/mcp`, and the Clerk webhook lack an explicit app-level body limit. Schema validation happens after reading/parsing the body; field-length limits do not bound parsing memory. Webhook verification also needs to read its signed body.

Fix: apply small route-appropriate byte limits before parsing or signature verification, preserving the larger photo allowance. Bound MCP batch size and tool concurrency, and configure server/proxy request deadlines. Authentication limits should also bound bearer-token length.

### Medium: exports reserve database connections without an operation limit

`src/account/account.ts:72` reserves a database connection and holds a read-only snapshot while streaming every account table. Cancellation releases it, and rows are streamed rather than loaded all at once. However, concurrent exports and slow downloads have no app-level ceiling or deadline. Large accounts amplify this issue.

Fix: one active export per account, a small global export concurrency limit, a cooldown, and a total duration limit. Bound stored account data. Set database statement, lock, and idle-transaction timeouts and use a separate least-privilege runtime database role. Migrations currently use the same configured database URL.

### Low: missing clickjacking protection in application headers

The page CSP has no `frame-ancestors` directive, and the application does not set `X-Frame-Options`. `frame-src` restricts child frames, not sites embedding Nouri. Production may add headers at a proxy; that was not checked.

Fix: add `frame-ancestors 'none'` unless embedding is required, a page referrer policy, and appropriate HTTPS headers at the public origin. Authenticated JSON responses should explicitly use `Cache-Control: private, no-store`.

## Controls that passed review

- `/v1/*` requires verified bearer session tokens. Unit tests reject unsigned, expired, missing-origin, and wrong-origin tokens.
- MCP accepts OAuth tokens separately from web session tokens. Integration tests reject using either token type on the other interface.
- Reviewed queries bind values through Drizzle/postgres.js and scope personal records by user id. Focused tests passed for cross-account food operations, photos, overview, exports, and MCP access. This is not a proof that every possible path is safe.
- Clerk account-deletion webhooks require signatures, and production startup requires a webhook signing secret.
- Google Health uses PKCE, random state, a matching HttpOnly cookie, expiry, and one-time state consumption. Provider tokens use AES-256-GCM with user/provider/purpose binding and are excluded from exports.
- Asset filenames reject traversal patterns. Photos have individual byte limits, safe content types, and private/no-store responses.
- `.env` is excluded from Git and Docker build context. The runtime image runs as the node user. No tracked `.env`, PEM/key file, or service-account credential filename was found. This does not establish that no secret exists in repository history or provider logs.

## Provider settings to check

| Provider | Action | Limit of this protection |
| --- | --- | --- |
| Clerk | For a personal app, select Invite-only access and inspect existing users. If access is public, enable bot protection and available registration restrictions. Disable unused SMS authentication and OAuth client registration. | Google-only sign-in does not mean only you can register. An API allowlist added in Nouri would not itself prevent Clerk account creation. |
| Neon | Set a small maximum compute size, enable scale-to-zero, monitor storage and transfer, and enable organization spending notifications. Inspect whether automatic suspension is actually available and selected. | A compute-size cap does not bound total active hours, storage, or transfer. The published spending-limit announcement describes alerts and automatic suspension as forthcoming. |
| Render | Keep one fixed-size instance unless scaling is deliberately needed. Monitor outbound bandwidth and set the build-pipeline spend limit. Protect public endpoints and check the default onrender.com URL. | Build-pipeline limits do not cap HTTP bandwidth. Render documents bandwidth overage billing when a payment method is linked. Its DDoS billing protection should not be assumed to cover ordinary authenticated abuse. |
| Google Cloud | Review enabled APIs, IAM, credentials, OAuth clients, and quotas. Disable unused services and apply low quotas where configurable. Set billing alerts and eligible-service spend caps if those services are used. | The reviewed code calls Google OAuth and Google Health, not resource-provisioning or AI APIs. OAuth client credentials are not general Cloud admin credentials. Google Health quotas are not proof of its billing model or your project's total exposure. |

Google Cloud spend caps currently cover specific eligible services, including Gemini API, Agent Platform, Cloud Run, and Cloud Run functions. Google Health is not listed. Enforcement has reporting latency and overages remain billable. Do not assume a general billing alert is a hard cap.

Sources: [Clerk access restrictions](https://clerk.com/docs/guides/secure/restricting-access), [Clerk bot protection](https://clerk.com/docs/guides/secure/bot-protection), [Neon compute settings](https://neon.com/docs/manage/endpoints/), [Neon spending-limit announcement](https://neon.com/blog/introducing-organization-spending-limits), [Render outbound bandwidth](https://render.com/docs/outbound-bandwidth), [Render billing FAQ](https://render.com/docs/faq), [Google spend caps](https://docs.cloud.google.com/billing/docs/how-to/budgets-spend-caps), [Google Health quotas](https://developers.google.com/health/rate-limits).

## Dependency audit and validation

`pnpm audit --prod` reported three high-severity advisories across the workspace:

- `braces` through `frontend > shadcn > fast-glob > micromatch`, [advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- `source-map-js` through frontend Tailwind build dependencies, fixed in 1.2.2, [advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
- An older MCP SDK through the frontend shadcn CLI, fixed in 1.31.0, [advisory](https://github.com/advisories/GHSA-6qxp-vccf-f47h). The API's direct MCP SDK is 1.32.1.

These dependency paths concern frontend CLI/build tooling. The runtime image installs the API package and serves built frontend assets. The audit does not establish that these advisories are remotely exploitable in deployed Nouri. Move CLI-only tools out of runtime dependencies and update affected build dependencies.

Validation completed locally against the existing localhost PostgreSQL container, using the test harness's isolated temporary schemas and fake provider services. No Neon connection or production load test was used.

- All 46 unit tests passed.
- All 19 tests passed across the focused app, account, MCP, overview, and Google Health integration suites.
- The mocked unknown-key JWT check rejected all three forged tokens while making three signing-key fetches.

Prioritize registration restrictions if this is private, then pre-authentication limits/local JWT verification, photo quotas, bounded sync/export operations, and provider settings. A production sign-off requires verifying the deployed revision and those settings.

## Structural review fixes verified

The shared-quota regression now accepts 120 writes and rejects 4,880 attempts without blocking a fresh account. Failed multi-budget reservations and rejected photo uploads also preserve the remaining allowances. All 61 unit tests, five focused integration suites, lint, type checking, and the frontend build passed. A fresh isolated browser run confirmed real Clerk sign-in, photo upload/view/delete and persisted readback, data export with deleted image bytes cleared, and sign-out with protected API access returning 401. Evidence is under `/tmp/nouri-verification-evidence/security-refactor-20261011`.

The security-only PR branch was then verified independently of the concurrent wearable work: all 61 unit tests and all 54 integration tests passed, along with lint, type checking, and the frontend build.
