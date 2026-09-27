import { and, eq, isNotNull, lt } from "drizzle-orm";
import { wearableConnections, wearableOauthStates } from "../db/schema.js";
import type { AppDatabase } from "../db/database.js";
import { importKinds } from "./contract.js";
import type { CallbackResult, ConnectionStatus, DisconnectResult, ImportKind, SyncResult, WearableProvider } from "./contract.js";
import { ProviderFailure, reauthorizeMessage } from "./provider.js";
import type { CloudProvider, ImportRecords, OAuthGrant, Pull, SyncWindow, WearableRuntime } from "./provider.js";
import { applyBatch, countImports, removeImports } from "./import-sync.js";
import { randomToken, sameSecret, sha256Base64url } from "../crypto.js";
import { vault } from "./token-vault.js";

type ConnectionRow = typeof wearableConnections.$inferSelect;

type LiveRow = ConnectionRow & { refreshToken: string };

type Pulls = { [K in ImportKind]?: Pull<ImportRecords[K]> };

const nothing = { created: 0, updated: 0, removed: 0, skipped: 0 };

export const stateLifetimeMs = 10 * 60_000;

// A connection is live while it holds a refresh token. Losing the grant clears the tokens but keeps the row, so its last error still shows.
const isLive = (row: ConnectionRow): row is LiveRow => row.refreshToken !== null;

const live = isNotNull(wearableConnections.refreshToken);

const connectionKey = (userId: string, provider: WearableProvider) => and(eq(wearableConnections.userId, userId), eq(wearableConnections.provider, provider));

async function recorded(db: AppDatabase, userId: string, provider: WearableProvider) {
  const [[row], imported] = await Promise.all([
    db.select().from(wearableConnections).where(connectionKey(userId, provider)),
    countImports(db, { userId, provider }),
  ]);

  return { row, fields: { lastSyncedAt: row?.lastSyncedAt?.toISOString() ?? null, lastError: row?.lastError ?? null, imported } };
}

// Status for a provider this server has no settings for. What it imported before still counts.
export async function unconfiguredStatus(db: AppDatabase, userId: string, provider: WearableProvider): Promise<ConnectionStatus> {
  const { fields } = await recorded(db, userId, provider);

  return { provider, connection: "not-configured", granted: [], ...fields, windowDays: null };
}

export type CallbackInput = { state: string | undefined; cookie: string | undefined; code: string | undefined; error: string | undefined };

export type SyncOutcome =
  | { outcome: "synced"; result: SyncResult }
  | { outcome: "not-connected" }
  | { outcome: "failed"; reason: "reauthorize" | "unavailable"; message: string };

export type Connection = ReturnType<typeof connectionFor>;

// One person's link to one configured provider.
export function connectionFor(db: AppDatabase, runtime: WearableRuntime, provider: CloudProvider, userId: string) {
  const tokens = vault(runtime.tokenKey, provider.id, userId);
  const key = connectionKey(userId, provider.id);
  const pendingStates = and(eq(wearableOauthStates.userId, userId), eq(wearableOauthStates.provider, provider.id));

  const stored = async (): Promise<ConnectionRow | null> => (await db.select().from(wearableConnections).where(key))[0] ?? null;

  function grantColumns(grant: OAuthGrant, now: Date) {
    return {
      accessToken: tokens.seal("access-token", grant.accessToken),
      accessTokenExpiresAt: new Date(now.getTime() + grant.expiresInSeconds * 1000),
      refreshToken: grant.refreshToken ? tokens.seal("refresh-token", grant.refreshToken) : undefined,
    };
  }

  function cachedToken(row: ConnectionRow): string | null {
    if (row.accessToken && row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() - 60_000 > runtime.now().getTime()) {
      return tokens.open("access-token", row.accessToken);
    }

    return null;
  }

  // Returns the refresh token to use next time, which is the new one when the provider rotated it.
  async function refreshed(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const grant = await provider.refresh(refreshToken);
    const now = runtime.now();

    await db.update(wearableConnections).set({ ...grantColumns(grant, now), updatedAt: now }).where(and(key, live));

    return { accessToken: grant.accessToken, refreshToken: grant.refreshToken ?? refreshToken };
  }

  // Reads every kind the grant covers with one access token, so a sync applies all of them or none.
  async function pullAll(accessToken: string, kinds: ImportKind[], window: SyncWindow): Promise<Pulls> {
    const pulls: Pulls = {};

    if (kinds.includes("sleep")) pulls.sleep = await provider.pull.sleep(accessToken, window);

    if (kinds.includes("workouts")) pulls.workouts = await provider.pull.workouts(accessToken, window);

    return pulls;
  }

  async function pullWithRetry(row: LiveRow, kinds: ImportKind[], window: SyncWindow): Promise<Pulls> {
    let refreshToken = tokens.open("refresh-token", row.refreshToken);
    let accessToken = cachedToken(row);

    if (!accessToken) ({ accessToken, refreshToken } = await refreshed(refreshToken));

    try {
      return await pullAll(accessToken, kinds, window);
    } catch (failure) {
      if (!(failure instanceof ProviderFailure) || failure.reason !== "unauthorized") throw failure;
    }

    // A refused access token gets one refresh before the grant needs a new sign-in.
    return pullAll((await refreshed(refreshToken)).accessToken, kinds, window);
  }

  return {
    provider,

    async status(): Promise<ConnectionStatus> {
      const { row, fields } = await recorded(db, userId, provider.id);

      const connection = !row ? "not-connected" : isLive(row) ? "connected" : "reauthorize";

      return { provider: provider.id, connection, granted: row && connection === "connected" ? provider.grantedKinds(row.scope) : [], ...fields, windowDays: provider.windowDays };
    },

    // The caller puts the returned state in an HttpOnly cookie; the callback needs both to match.
    async start(): Promise<{ url: string; state: string }> {
      const state = randomToken();
      const verifier = randomToken();
      const now = runtime.now();

      await db.delete(wearableOauthStates).where(and(eq(wearableOauthStates.userId, userId), lt(wearableOauthStates.expiresAt, now)));
      await db.insert(wearableOauthStates).values({
        stateHash: sha256Base64url(state),
        userId,
        provider: provider.id,
        codeVerifier: tokens.seal("code-verifier", verifier),
        expiresAt: new Date(now.getTime() + stateLifetimeMs),
      });

      return { url: provider.authorizationUrl(state, sha256Base64url(verifier)), state };
    },

    async complete(input: CallbackInput): Promise<CallbackResult> {
      // The cookie proves this browser started the sign-in, so a link from someone else cannot connect their account here.
      if (!input.state || !sameSecret(input.cookie, input.state)) return "expired-link";

      const [pending] = await db.delete(wearableOauthStates).where(and(pendingStates, eq(wearableOauthStates.stateHash, sha256Base64url(input.state)))).returning();

      if (!pending || pending.expiresAt.getTime() < runtime.now().getTime()) return "expired-link";

      if (input.error) return input.error === "access_denied" ? "denied" : "token-failed";

      if (!input.code) return "token-failed";

      let grant: OAuthGrant;

      try {
        grant = await provider.exchangeCode(input.code, tokens.open("code-verifier", pending.codeVerifier));
      } catch {
        return "token-failed";
      }

      if (provider.grantedKinds(grant.scope).length === 0) {
        await provider.revoke(grant.refreshToken ?? grant.accessToken);

        return "missing-scope";
      }

      if (!grant.refreshToken) return "token-failed";
      const now = runtime.now();
      const columns = { scope: grant.scope, ...grantColumns(grant, now), lastError: null, updatedAt: now };

      await db.insert(wearableConnections).values({ userId, provider: provider.id, ...columns })
        .onConflictDoUpdate({ target: [wearableConnections.userId, wearableConnections.provider], set: columns });

      return "connected";
    },

    async sync(): Promise<SyncOutcome> {
      const row = await stored();

      if (!row) return { outcome: "not-connected" };

      if (!isLive(row)) return { outcome: "failed", reason: "reauthorize", message: row.lastError ?? reauthorizeMessage };

      const started = runtime.now();
      const since = new Date(started.getTime() - provider.windowDays * 86_400_000);
      // The workout window starts on the UTC date of the same instant. Any date works, as long as the
      // provider's filter and the deletion scope below use the same one.
      const window: SyncWindow = { endedSince: since, startedOnOrAfter: since.toISOString().slice(0, 10) };
      const kinds = provider.grantedKinds(row.scope);
      let pulls: Pulls;

      try {
        pulls = await pullWithRetry(row, kinds, window);
      } catch (failure) {
        if (!(failure instanceof ProviderFailure)) throw failure;

        const reason = failure.reason === "unavailable" ? "unavailable" : "reauthorize";

        // Losing the grant drops the tokens but keeps imported sleep, which stays true until the provider says otherwise.
        const common = { lastError: failure.message, updatedAt: started };

        const update = reason === "reauthorize"
          ? { ...common, refreshToken: null, accessToken: null, accessTokenExpiresAt: null }
          : common;

        await db.update(wearableConnections).set(update).where(key);

        return { outcome: "failed", reason, message: failure.message };
      }

      const partial = importKinds.filter((kind) => pulls[kind]?.complete === false);
      const lastError = partial.length === 0 ? null : `The provider returned more ${partial.join(" and ")} than one sync reads, so no deletions were applied there.`;
      const owner = { userId, provider: provider.id };

      const result = await db.transaction(async (tx): Promise<SyncResult | null> => {
        // Writing the row first locks it, which serializes syncs and stops one racing a disconnect.
        const [held] = await tx.update(wearableConnections).set({ lastSyncedAt: started, lastError, updatedAt: started }).where(and(key, live)).returning({ userId: wearableConnections.userId });

        if (!held) return null;

        return {
          sleep: pulls.sleep ? await applyBatch(tx, "sleep", owner, window, pulls.sleep) : nothing,
          workouts: pulls.workouts ? await applyBatch(tx, "workouts", owner, window, pulls.workouts) : nothing,
        };
      });

      if (!result) return { outcome: "not-connected" };

      return { outcome: "synced", result };
    },

    // Revokes the provider's grant, then forgets the tokens and removes everything imported from it.
    async disconnect(): Promise<DisconnectResult> {
      const row = await stored();
      const revoked = row && isLive(row) ? await provider.revoke(tokens.open("refresh-token", row.refreshToken)) : false;

      const removed = await db.transaction(async (tx) => {
        // Deleting the row first locks it, so a sync still in flight finds nothing to write to.
        await tx.delete(wearableConnections).where(key);
        await tx.delete(wearableOauthStates).where(pendingStates);

        return removeImports(tx, { userId, provider: provider.id });
      });

      return { revoked, removed };
    },
  };
}
