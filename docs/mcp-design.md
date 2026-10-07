# MCP server for logging meals and workouts

## Problem

Logging a meal means opening the page, searching, and picking amounts. Typing "two eggs and toast at 8, then 40 minutes of squats and bench" into ChatGPT or Claude is faster, and those assistants can already estimate nutrients. Both connect to remote [MCP](https://modelcontextprotocol.io) servers over Streamable HTTP and sign in with OAuth 2.1. They discover the authorization server through [protected resource metadata (RFC 9728)](https://datatracker.ietf.org/doc/html/rfc9728) and register themselves with dynamic client registration. Neither accepts a pasted API key in its web app. Nouri's REST API only accepts Clerk session tokens minted for the web app's origins, so an assistant cannot use it.

The server should be small. It logs meals and workouts, reads a day back so the assistant can check its work and answer "how much protein is left", and removes an entry the assistant got wrong.

## Usage (caller's view)

The person adds `https://<nouri host>/mcp` as a custom connector in Claude or ChatGPT. The assistant opens Clerk's consent page; the person signs in with their Nouri account and approves. The assistant then sees five tools.

```ts
// "Two eggs and a slice of toast at 8."
search_foods({ query: "egg boiled" })
// → { items: [{ ref: { provider: "ciqual", id: "22010", version: "2025" }, name: "Egg, boiled", nutrients: { kcal: 134, ... } }] }

log_meal({
  time: "08:00",
  items: [
    { ref: { provider: "ciqual", id: "22010", version: "2025" }, grams: 120 },
    { name: "Wholemeal toast", amount: 35, unit: "g", nutrients: { kcal: 85, proteinG: 4, carbsG: 15, fatG: 1 } },
  ],
})
// → { date: "2026-10-07", timeZone: "Europe/Lisbon", entries: [{ id, food: { name, quantity, nutrients } }, ...] }

// "40 minutes of strength: squats 5x5 at 100, bench 3x8 at 70."
log_workout({ activity: "strength", durationMinutes: 40, exercises: [
  { name: "Squat", sets: 5, reps: 5, weightKg: 100 },
  { name: "Bench press", sets: 3, reps: 8, weightKg: 70 },
] })

get_day({})                              // today: food entries and totals, workouts, targets
delete_entry({ kind: "food", id })       // undo a wrong log
```

`date` and `time` are the person's wall-clock values and default to now. The assistant never computes UTC instants or offsets. The time zone defaults to the zone of the person's latest manual entry; the assistant passes `timeZone` only when the person has none yet or is travelling. Revisions and idempotency keys stay inside the server.

## Shape

```
src/mcp/routes.ts   mcpRoutes(db, identity, publicUrl?) → Hono app
                    POST/GET/DELETE /mcp, /.well-known/oauth-protected-resource[/mcp]
src/mcp/tools.ts    nouriMcpServer(db, userId) → McpServer with the five tools
src/food/food.ts    logFoods(db, userId, when, items)   (new, atomic multi-food insert)
src/time.ts         instantAt(date, time, zone)          (new, wall clock → ISO instant)
src/identity/identity.ts
                    Identity.authenticateAgent           (new, Clerk OAuth access token → Clerk user id)
```

```ts
// identity.ts — the only module that knows about Clerk.
export type Identity = {
  authenticate: Authenticate;       // web app session tokens
  authenticateAgent: Authenticate;  // OAuth access tokens Clerk issued to an MCP client
  publishableKey: string;
};

// routes.ts
export function mcpRoutes(db: AppDatabase, identity: Identity, publicUrl?: string): Hono;
// 401 → WWW-Authenticate: Bearer resource_metadata="<origin>/.well-known/oauth-protected-resource/mcp"
// metadata → { resource: "<origin>/mcp", authorization_servers: [clerkFrontendOrigin(key)], scopes_supported: ["profile", "email"] }
// Each request builds a stateless McpServer bound to the caller's user id and a WebStandardStreamableHTTPServerTransport.

// tools.ts
export function nouriMcpServer(db: AppDatabase, userId: string): McpServer;

// food.ts
export type FoodItem = RecordedFood | { ref: CatalogSelection; grams: number };
export async function logFoods(db: AppDatabase, userId: string, when: { occurredAt: string; timeZone: string }, items: FoodItem[]):
  Promise<{ outcome: "created"; entries: FoodEntry[] } | { outcome: "catalog-missing" }>;

// time.ts
export function instantAt(date: string, time: string, zone: string): string;
```

`/mcp` sits outside `/v1/*`, so the session-token and `Idempotency-Key` middleware do not apply. Writes reuse the journal's own operations: `logFoods` calls `insertFoods` in one transaction, `log_workout` calls `mutateRecord(workoutRecords)`, and `delete_entry` reads the current revision then calls `mutateFood` or `mutateRecord` with a delete. A meal is atomic: an unknown catalog food fails the whole call and logs nothing.

## Synthesis decision

Two tool surfaces were compared.

1. **Mirror the REST API** as tools: `create_food_entry` taking the existing submission union, `create_workout`, `delete_*` with a revision, `get_day`. No new domain code, but the model must produce UTC instants with offsets, manage idempotency keys and revisions, and log a meal one food per call with no atomicity. Every REST detail passes straight through to a caller that is bad at exactly those details.
2. **Intent-shaped tools** (chosen). Five tools that take wall-clock time, infer the time zone, take a whole meal, and hide revisions. The interface is smaller and the server absorbs the error-prone parts: zone math, DST, retries, revision lookup. The cost is one domain function (`logFoods`) and one time helper.

Two authorization shapes were compared.

1. **Clerk as the OAuth authorization server** (chosen). Clerk already holds the accounts, supports dynamic client registration and consent screens, and issues OAuth access tokens that `@clerk/backend` verifies with `acceptsToken: "oauth_token"`. Nouri serves one metadata document and checks a bearer token. A token's `subject` is the same Clerk user id the web app sees, so `userFor` maps it to the same records.
2. **Nouri as its own authorization server**: authorize and token endpoints, PKCE, client registration, a codes and tokens table, a consent page behind Clerk sign-in. Hundreds of lines of security-sensitive code that duplicate what Clerk provides.

Placement: a separate MCP process that calls the REST API was rejected. The REST middleware accepts only session tokens, so the proxy would need its own credentials anyway, and it would add a network hop and a second deployment for no isolation gain.

## Tradeoffs accepted

- Clerk OAuth access tokens are opaque by default and verified with a Clerk API call, so each MCP request costs one round trip to Clerk. Tool calls are infrequent; switching the OAuth application to JWT access tokens would make verification local.
- Each tool call gets a fresh idempotency key. MCP clients do not retry tool calls on their own, and a key derived from the arguments would block logging the same food twice on purpose.
- The assistant's nutrient estimates are stored as manual foods. They are labelled by whatever name the assistant gives; a catalog `ref` from `search_foods` is preferred when one matches.
- Stateless transport: no MCP sessions, no server-sent notifications. The five tools are request-response only.
- The connector needs a public HTTPS origin. Locally, use a tunnel and set `NOURI_PUBLIC_URL` to it.

## Setup

In the Clerk dashboard, open **Configure → OAuth applications** and turn on **Dynamic client registration**. Set `NOURI_PUBLIC_URL` to the origin the assistant reaches (for example `https://nouri.example.com`); without it the server uses the request's own origin. Add `https://<origin>/mcp` as a custom connector in Claude (Settings → Connectors) or ChatGPT (Settings → Apps → developer mode).

## Not in this version

- Editing an entry. The assistant deletes and logs again.
- Water, supplements, sleep, measurements, saved meals, and exercise history.
- Revoking a connector from Nouri's own page. Clerk's user profile lists and revokes OAuth grants.
