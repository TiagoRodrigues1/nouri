# Sign-in with Clerk

## Problem

Nouri trusted one shared `API_TOKEN` and filed every request under one configured `API_USER_ID`. The page included the token, so anyone who could load it could use the API, and the server had to stay on loopback. Nouri will run as a hosted service with many accounts, so each request must prove who sent it, and each person may see only their own records. The data layer already scoped everything by `user_id`; only the identity was fake.

## Usage (caller's view)

The browser never handles a token. API functions take only their arguments:

```ts
const day = await getDay("2026-10-02");
```

`request()` asks Clerk for the current session token on every call, since tokens live about a minute. The page renders nothing but Clerk's sign-in until someone signs in. Each account gets its own TanStack Query cache, keyed by Clerk user id, so one person's data cannot appear to the next person who signs in on the same browser.

The server sees a domain user id, as before:

```ts
app.use("/v1/*", async (context, next) => {
  const clerkUserId = await identity.authenticate(context.req.raw);
  if (!clerkUserId) return error(401, "Unauthorized");
  context.set("userId", await userFor(db, clerkUserId));
  await next();
});
```

## Shape

- `src/identity/identity.ts` is the only module that knows about Clerk. `Identity` is `{ authenticate, publishableKey }`. `clerkAuthenticator` verifies the bearer JWT with `@clerk/backend`'s `verifyToken`, which checks it against `CLERK_AUTHORIZED_PARTIES`. `userFor` maps a Clerk user id to a `users.id` and creates the row on first sight. `identityFromEnv` reads the three `CLERK_*` settings.
- `users (id uuid, clerk_user_id text unique)`. Every existing `user_id` column keeps meaning `users.id`.
- `createApp(db, identity, wearables)`. Tests pass an `authenticate` that maps a fixed bearer string to a Clerk user id, so no test calls Clerk.
- The page receives the publishable key in a `<meta>` tag, from the API at request time or from the Vite plugin in development. The CSP allows the instance's Frontend API host (decoded from the key), `img.clerk.com`, and Cloudflare's bot-protection frame.
- Google Health routes act for `context.get("userId")` per request. The OAuth callback comes back by browser redirect without a session, so `stateOwner` reads the user from the stored state. `complete()` still requires the matching `HttpOnly` cookie and consumes the state.

## Synthesis decision

Two shapes were compared for linking Clerk to records.

1. **A `users` table that maps Clerk ids to UUIDs** (chosen). It adds one indexed lookup per request. Records stay independent of the auth vendor, existing data can be linked to an account with one insert, and the planned `users`/`consents` work in [backend-architecture.md](backend-architecture.md) has a place to grow.
2. **A UUIDv5 derived from the Clerk id**, with no table. This is smaller today, but every row would be tied to Clerk forever, existing data could not be linked, and a later `users` table would mean rewriting every `user_id`.

On the client, the existing code passed `token: string` through about 30 hooks and components, and used it in query keys. Clerk tokens rotate every minute, so a rotating token in query keys would refetch everything. Moving the token lookup inside `request()` removed the parameter from the whole frontend.

## Tradeoffs accepted

- `verifyToken` fetches Clerk's JWKS (it caches them), so a Clerk outage before the cache fills turns into 401s. Setting `jwtKey` would make verification networkless if that becomes a problem.
- The first request from a new person inserts a row. A race between parallel first requests is settled by the unique column.
- Clerk's prebuilt `<SignIn>` uses the `shadcn` theme from `@clerk/ui`, which reads the same `:root` variables as `components/ui`. It is not built from shadcn components; that would mean reimplementing sign-up, verification, MFA, and OAuth flows.
- The `verifyToken` that `@clerk/backend` exports resolves to the claims and throws on failure, while its type says it returns `{ data, errors }`. Code that trusts the type rejects every real token. `tests/unit/identity.test.ts` runs the real function against a locally signed token, and the `sub` claim is validated with zod.

## Not in this version

Account deletion and data export arrived later; see [account-data-design.md](account-data-design.md).

- Organizations, roles, and billing.
- A native app. It would send Clerk session tokens the same way.
