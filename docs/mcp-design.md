# MCP server for logging meals and workouts

## Problem

Logging a meal means opening the page, searching, and picking amounts. Typing "two eggs and toast at 8, then 40 minutes of squats and bench" into ChatGPT or Claude is faster, and those assistants can already estimate nutrients. Both connect to remote [MCP](https://modelcontextprotocol.io) servers over Streamable HTTP and sign in with OAuth 2.1. They discover the authorization server through [protected resource metadata (RFC 9728)](https://datatracker.ietf.org/doc/html/rfc9728) and register themselves with dynamic client registration. Neither accepts a pasted API key in its web app. Nouri's REST API only accepts Clerk session tokens minted for the web app's origins, so an assistant cannot use it.

The server should be small. It logs what the web app logs (meals, saved meals, workouts, water, supplements, sleep, and body measurements), fixes a logged food, reads a day back so the assistant can check its work and answer "how much protein is left", and removes an entry the assistant got wrong.

## Usage (caller's view)

The person adds `https://<nouri host>/mcp` as a custom connector in Claude or ChatGPT. The assistant opens Clerk's consent page; the person signs in with their Nouri account and approves. The assistant then sees twelve tools.

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

// "Half a litre of water, my creatine and zinc, and I weigh 72.4."
log_water({ volumeMl: 500 })
take_supplements({ supplementIds: [creatineId, zincId] })   // ids from get_day's supplements
log_measurement({ kind: "weight", value: 72.4 })            // kg; also height and waist in cm, body fat in %

// "Slept from 23:30 to 7:10."
log_sleep({ bedtime: "23:30", wakeTime: "07:10" })          // the night belongs to today, the morning it ended

// "My usual breakfast, but half the oats."
list_saved_meals({})
log_saved_meal({ mealId, items: [{ id: oatsItemId, amount: 40 }] })   // items left out: every item at its saved amount

// "That was 120 g, at 9:15."
edit_food({ id, amount: 120, time: "09:15" })   // nutrients scale with the amount; the date and zone stay the entry's

get_day({})                              // today: food, water, supplements, workouts, sleep, measurements, targets
delete_entry({ kind: "water", id })      // food, workout, water, supplement, sleep, or measurement
```

`date` and `time` are the person's wall-clock values and default to now. The assistant never computes UTC instants or offsets, nor which day a bedtime falls on. The time zone defaults to the zone of the person's latest manual entry of any kind; the assistant passes `timeZone` only when the person has none yet or is travelling. Revisions and idempotency keys stay inside the server.

## Shape

```
src/mcp/routes.ts   mcpRoutes(db, identity, publicUrl?) → Hono app
                    POST/GET/DELETE /mcp, /.well-known/oauth-protected-resource[/mcp]
src/mcp/tools.ts    nouriMcpServer(db, userId) → McpServer with the twelve tools
src/food/food.ts    logFoods(db, userId, when, items)   (atomic multi-food insert)
                    editFood(db, userId, id, edit)      (wall-clock edit against the stored row)
src/supplements/supplements.ts
                    takeSupplements(db, userId, when, ids)   (atomic multi-intake insert)
src/time.ts         instantAt(date, time, zone)          (wall clock → ISO instant)
                    localTime(instant, zone)             (ISO instant → wall clock)
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

// A date or time left out keeps the entry's own; the zone never changes. Own nutrients drop the catalog ref.
export type FoodEdit = { date?: string; time?: string; name?: string; amount?: number; nutrients?: Nutrients };
export async function editFood(db: AppDatabase, userId: string, id: string, edit: FoodEdit):
  Promise<{ outcome: "updated"; entry: FoodEntry } | { outcome: "missing" | "stale" | "invalid-amount" }>;

// supplements.ts — shares its insert with intakeRecords.create, so the stack check lives in one place.
export async function takeSupplements(db: AppDatabase, userId: string, when: { occurredAt: string; timeZone: string }, supplementIds: string[]):
  Promise<{ outcome: "created"; entries: SupplementIntake[] } | { outcome: "unknown-reference"; message: string }>;

// time.ts
export function instantAt(date: string, time: string, zone: string): string;
export function localTime(instant: string, zone: string): string;
```

`/mcp` sits outside `/v1/*`, so the session-token and `Idempotency-Key` middleware do not apply. Writes reuse the journal's own operations. `logFoods` calls `insertFoods` in one transaction. `log_saved_meal` calls `logMeal`. `log_workout`, `log_water`, `log_sleep`, and `log_measurement` parse with the REST input schema and call `mutateRecord`, so range and length checks answer the assistant in words. `edit_food` locks the row, applies the change on the entry's own wall clock, and updates it at the revision it read. `delete_entry` looks the kind up in a table of `RecordKind`s, reads the current revision, and deletes through `mutateRecord`, or `mutateFood` for food; a kind with a `deletable` filter is one whose imported rows it refuses. A meal, a saved meal, and a set of supplements are each atomic: one unknown catalog food, saved item, or off-stack supplement fails the whole call and logs nothing.

`get_day` returns `getDay` (food, water, supplements) with workouts, sleep, the measurement summary, and targets for the day.

## Synthesis decision

Two tool surfaces were compared.

1. **Mirror the REST API** as tools: `create_food_entry` taking the existing submission union, `create_workout`, `delete_*` with a revision, `get_day`. No new domain code, but the model must produce UTC instants with offsets, manage idempotency keys and revisions, and log a meal one food per call with no atomicity. Every REST detail passes straight through to a caller that is bad at exactly those details.
2. **Intent-shaped tools** (chosen). Five tools that take wall-clock time, infer the time zone, take a whole meal, and hide revisions. The interface is smaller and the server absorbs the error-prone parts: zone math, DST, retries, revision lookup. The cost is one domain function (`logFoods`) and one time helper.

Two authorization shapes were compared.

1. **Clerk as the OAuth authorization server** (chosen). Clerk already holds the accounts, supports dynamic client registration and consent screens, and issues OAuth access tokens that `@clerk/backend` verifies with `acceptsToken: "oauth_token"`. Nouri serves one metadata document and checks a bearer token. A token's `subject` is the same Clerk user id the web app sees, so `userFor` maps it to the same records.
2. **Nouri as its own authorization server**: authorize and token endpoints, PKCE, client registration, a codes and tokens table, a consent page behind Clerk sign-in. Hundreds of lines of security-sensitive code that duplicate what Clerk provides.

Placement: a separate MCP process that calls the REST API was rejected. The REST middleware accepts only session tokens, so the proxy would need its own credentials anyway, and it would add a network hop and a second deployment for no isolation gain.

The second version added seven tools to these five. Three surfaces were compared.

1. **One tool per intent** (chosen): `log_water`, `take_supplements`, `log_sleep`, `log_measurement`, `list_saved_meals`, `log_saved_meal`, `edit_food`. Models route by tool name and description, so each intent gets its own words and a flat schema. The shared parts (wall clock, zone inference, REST-schema parsing, revision lookup) stay inside `tools.ts` as three helpers.
2. **One `log_entry({ kind, ... })` tool** with a union of per-kind inputs. Fewer names, but not a smaller interface: the assistant learns the same fields behind a `kind` switch, the descriptions blur together, and MCP clients render a top-level union poorly. Its registry idea survives inside `delete_entry`.
3. **`edit_entry` for every kind**, as a delete and a re-log in one transaction. Journal records other than food are never updated, so this would change ids and hide a rule the rest of the app keeps. For those kinds the assistant still deletes and logs again.

## Tradeoffs accepted

- Clerk OAuth access tokens are opaque by default and verified with a Clerk API call, so each MCP request costs one round trip to Clerk. Tool calls are infrequent; switching the OAuth application to JWT access tokens would make verification local.
- Each tool call gets a fresh idempotency key. MCP clients do not retry tool calls on their own, and a key derived from the arguments would block logging the same food twice on purpose.
- The assistant's nutrient estimates are stored as manual foods. They are labelled by whatever name the assistant gives; a catalog `ref` from `search_foods` is preferred when one matches.
- Stateless transport: no MCP sessions, no server-sent notifications. The tools are request-response only.
- `log_sleep` reads a bedtime later than the wake time as the evening before. A nap that starts and ends at the same clock time would read as 24 hours; the sleep schema allows that.
- `log_saved_meal` without items reads every saved meal to find the one asked for. A person has a handful.
- `edit_food` and `take_supplements`, like `logFoods`, keep no idempotency receipt; each tool call is one attempt.
- `get_day` returns the 30-day weight history inside the measurement summary. That is a few hundred bytes the assistant can use or skip.
- The connector needs a public HTTPS origin. Locally, use a tunnel and set `NOURI_PUBLIC_URL` to it.

## Setup

In the Clerk dashboard, open **Configure → OAuth applications** and turn on **Dynamic client registration**. Set `NOURI_PUBLIC_URL` to the origin the assistant reaches (for example `https://nouri.example.com`); without it the server uses the request's own origin. Add `https://<origin>/mcp` as a custom connector in Claude (Settings → Connectors) or ChatGPT (Settings → Apps → developer mode).

## Not in this version

- Editing anything but food. The assistant deletes and logs again.
- Changing the supplement stack, targets, or saved meals themselves, and exercise history.
- Revoking a connector from Nouri's own page. Clerk's user profile lists and revokes OAuth grants.
