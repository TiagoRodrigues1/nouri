import { and, eq, isNotNull, isNull, lt, lte, or, type SQL } from "drizzle-orm";
import { wearableConnections, wearableOauthStates } from "../db/schema.js";
import type { AppDatabase, Transaction } from "../db/database.js";
import { importKindNames } from "./contract.js";
import type { CallbackResult, ConnectionStatus, DisconnectResult, ImportCounts, ImportKind, SyncResult, WearableProvider } from "./contract.js";
import { everything, ProviderFailure, reauthorizeMessage } from "./provider.js";
import type { CloudProvider, OAuthGrant, SyncScope, SyncWindow, WearableRuntime } from "./provider.js";
import { applyBatch, countImports, eachKind, removeImports } from "./import-sync.js";
import { randomToken, sameSecret, sha256Base64url } from "../crypto.js";
import { vault } from "./token-vault.js";
import { syncTiming } from "./sync-timing.js";
import { shiftDate, utcDate } from "../time.js";

type ConnectionRow = typeof wearableConnections.$inferSelect;

type LiveRow = ConnectionRow & { refreshToken: string };

// One kind's records, read and waiting for the sync's transaction.
type Pulled = { kind: ImportKind; complete: boolean; apply: (tx: Transaction) => Promise<ImportCounts> };

const nothing = { created: 0, updated: 0, removed: 0, skipped: 0 };

const allOf = new Intl.ListFormat("en", { type: "conjunction" });

export const stateLifetimeMs = 10 * 60_000;

// A connection is live while it holds a refresh token. Losing the grant clears the tokens but keeps the row, so its last error still shows.
const isLive = (row: ConnectionRow): row is LiveRow => row.refreshToken !== null;

const live = isNotNull(wearableConnections.refreshToken);

export const connectionKey = (userId: string, provider: WearableProvider) => and(eq(wearableConnections.userId, userId), eq(wearableConnections.provider, provider));

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

// Who started the sign-in this callback state belongs to. complete() still checks the browser's cookie and consumes the state.
export async function stateOwner(db: AppDatabase, provider: WearableProvider, state: string): Promise<string | null> {
  const [pending] = await db.select({ userId: wearableOauthStates.userId }).from(wearableOauthStates)
    .where(and(eq(wearableOauthStates.provider, provider), eq(wearableOauthStates.stateHash, sha256Base64url(state))));

  return pending?.userId ?? null;
}

export type CallbackInput = { state: string | undefined; cookie: string | undefined; code: string | undefined; error: string | undefined };

export type SyncOutcome =
  | { outcome: "synced"; result: SyncResult }
  | { outcome: "not-connected" }
  // Nothing was read: another sync of this connection is running, or Sync now was pressed within its cooldown.
  | { outcome: "busy"; reason: "running" | "cooldown"; retryAfterMs: number }
  | { outcome: "failed"; reason: "reauthorize" | "unavailable"; message: string };

export type Connection = ReturnType<typeof connectionFor>;

// One person's link to one configured provider.
export function connectionFor(db: AppDatabase, runtime: WearableRuntime, provider: CloudProvider, userId: string) {
  const tokens = vault(runtime.tokenKey, provider.id, userId);
  const key = connectionKey(userId, provider.id);
  const pendingStates = and(eq(wearableOauthStates.userId, userId), eq(wearableOauthStates.provider, provider.id));
  const owner = { userId, provider: provider.id };

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

  // While a sync runs, only it may write to the connection: the lease it took at `started` must still be its own.
  // A newer sync, or a new sign-in, replaces the lease, and the older run's tokens, errors, and records stay out.
  const holding = (started: Date) => and(key, eq(wearableConnections.syncStartedAt, started));

  // Returns the refresh token to use next time, which is the new one when the provider rotated it.
  async function refreshed(refreshToken: string, started: Date): Promise<{ accessToken: string; refreshToken: string }> {
    const grant = await provider.refresh(refreshToken);
    const now = runtime.now();

    await db.update(wearableConnections).set({ ...grantColumns(grant, now), updatedAt: now }).where(and(holding(started), live));

    return { accessToken: grant.accessToken, refreshToken: grant.refreshToken ?? refreshToken };
  }

  async function pullKind<K extends ImportKind>(accessToken: string, kind: K, window: SyncWindow): Promise<Pulled> {
    const batch = await provider.pull[kind](accessToken, window);

    return { kind, complete: batch.complete, apply: (tx) => applyBatch(tx, kind, owner, window, batch) };
  }

  // Reads every kind the grant covers with one access token, so a sync applies all of them or none.
  const pullAll = (accessToken: string, kinds: ImportKind[], window: SyncWindow) => Promise.all(kinds.map((kind) => pullKind(accessToken, kind, window)));

  // The provider's ID for the person, or null when it cannot say right now; the next sync asks again.
  const accountId = (accessToken: string) => provider.accountId(accessToken).catch(() => null);

  async function withAccessToken<T>(row: LiveRow, started: Date, use: (accessToken: string) => Promise<T>): Promise<T> {
    let refreshToken = tokens.open("refresh-token", row.refreshToken);
    let accessToken = cachedToken(row);

    if (!accessToken) ({ accessToken, refreshToken } = await refreshed(refreshToken, started));

    try {
      return await use(accessToken);
    } catch (failure) {
      if (!(failure instanceof ProviderFailure) || failure.reason !== "unauthorized") throw failure;
    }

    // A refused access token gets one refresh before the grant needs a new sign-in.
    return use((await refreshed(refreshToken, started)).accessToken);
  }

  // The full window ends `windowDays` before the sync started. A scope with a later `since` reads from that UTC date.
  // The days start on the UTC date of endedSince. Any date works, as long as the provider's filter and the deletion
  // scope use the same one. They end two days past today's UTC date, so today is in every zone. Google's own CLI
  // asks for today with an end of tomorrow, so a range ending ahead of now is expected.
  // `whole` says the window was not narrowed.
  function windowFor(started: Date, since: string | null) {
    const full = new Date(started.getTime() - provider.windowDays * 86_400_000);
    const narrowed = since === null ? full : new Date(`${since}T00:00:00Z`);
    const whole = narrowed <= full;
    const endedSince = whole ? full : narrowed;

    return { window: { endedSince, days: { from: utcDate(endedSince), until: shiftDate(utcDate(started), 2) } }, whole };
  }

  // Reads the kinds from the provider, then applies them all in one transaction. The caller holds the sync lease.
  async function pullAndApply(row: LiveRow, started: Date, window: SyncWindow, kinds: ImportKind[], reconciled: boolean): Promise<SyncOutcome> {
    let pulled: Pulled[];
    let providerUserId: string | null;

    try {
      [pulled, providerUserId] = await withAccessToken(row, started, (accessToken) => Promise.all([pullAll(accessToken, kinds, window), row.providerUserId ?? accountId(accessToken)]));
    } catch (failure) {
      if (!(failure instanceof ProviderFailure)) throw failure;

      const reason = failure.reason === "unavailable" ? "unavailable" : "reauthorize";

      // Losing the grant drops the tokens but keeps imported sleep, which stays true until the provider says otherwise.
      const common = { lastError: failure.message, updatedAt: started };

      const update = reason === "reauthorize"
        ? { ...common, refreshToken: null, accessToken: null, accessTokenExpiresAt: null }
        : common;

      const [recorded] = await db.update(wearableConnections).set(update).where(holding(started)).returning({ userId: wearableConnections.userId });

      // A run that lost its lease leaves the failure unrecorded, so it cannot clear a newer grant or its error.
      if (!recorded) return superseded();

      return { outcome: "failed", reason, message: failure.message };
    }

    const partial = pulled.flatMap((pull) => pull.complete ? [] : [importKindNames[pull.kind]]);
    const lastError = partial.length === 0 ? null : `The provider returned more ${allOf.format(partial)} than one sync reads, so no deletions were applied there.`;
    const byKind = new Map(pulled.map((pull) => [pull.kind, pull]));

    const result = await db.transaction(async (tx): Promise<SyncResult | null> => {
      // Writing the row first locks it, which serializes syncs and stops one racing a disconnect. It must still hold
      // this sync's lease: one that outlived its lease lost it to a newer sync, whose fresher read is the one to keep.
      // Drizzle leaves a column it is given undefined for unchanged.
      const columns = { lastSyncedAt: started, lastError, providerUserId, updatedAt: started, reconciledAt: reconciled ? started : undefined };
      const [held] = await tx.update(wearableConnections).set(columns).where(and(holding(started), live)).returning({ userId: wearableConnections.userId });

      if (!held) return null;

      // A kind the grant does not cover reports zeros.
      return eachKind(async (kind) => byKind.get(kind)?.apply(tx) ?? nothing);
    });

    if (!result) return superseded();

    return { outcome: "synced", result };
  }

  const lostGrant = (row: ConnectionRow): SyncOutcome => ({ outcome: "failed", reason: "reauthorize", message: row.lastError ?? reauthorizeMessage });

  const table = wearableConnections;

  // No other sync holds the lease, or the one that did has lapsed.
  const idle = (started: Date) => or(isNull(table.syncStartedAt), lt(table.syncStartedAt, new Date(started.getTime() - syncTiming.leaseMs)));

  // Sync now's cooldown: the last sync finished long enough ago, or the grant has not had a full read yet.
  // Sync now is a full read, so the cooldown first applies once a sign-in's first one has run.
  const cooled = (started: Date) =>
    or(isNull(table.lastSyncedAt), lte(table.lastSyncedAt, new Date(started.getTime() - syncTiming.manualCooldownMs)), isNull(table.reconciledAt));

  const busyRunning: SyncOutcome = { outcome: "busy", reason: "running", retryAfterMs: syncTiming.busyRetryMs };

  // Why a run that lost its lease saved nothing: the connection is gone, its grant was lost, or a newer sync or sign-in took over.
  async function superseded(): Promise<SyncOutcome> {
    const current = await stored();

    if (!current) return { outcome: "not-connected" };

    return isLive(current) ? busyRunning : lostGrant(current);
  }

  // Why the lease was refused: the connection changed, another sync holds it, or the cooldown has not passed.
  async function refused(started: Date): Promise<SyncOutcome> {
    const current = await stored();

    if (!current) return { outcome: "not-connected" };

    if (!isLive(current)) return lostGrant(current);
    const running = current.syncStartedAt && current.syncStartedAt.getTime() > started.getTime() - syncTiming.leaseMs;

    if (running || !current.lastSyncedAt) return busyRunning;

    return { outcome: "busy", reason: "cooldown", retryAfterMs: Math.max(current.lastSyncedAt.getTime() + syncTiming.manualCooldownMs - started.getTime(), 1000) };
  }

  // Reads the granted kinds the scope names while holding the connection's lease. `gate` is a further condition the
  // lease must meet; taking the lease and checking it in one statement means two requests cannot both pass.
  async function leasedSync(scope: SyncScope, gate: (started: Date) => SQL | undefined): Promise<SyncOutcome> {
    const row = await stored();

    if (!row) return { outcome: "not-connected" };

    if (!isLive(row)) return lostGrant(row);

    const started = runtime.now();
    const { window, whole } = windowFor(started, scope.since);
    const granted = provider.grantedKinds(row.scope);
    const kinds = granted.filter((kind) => scope.kinds.includes(kind));
    // Only a full re-read can see every deletion inside the window, so only it counts as reconciliation.
    const reconciled = whole && kinds.length === granted.length;

    // Nothing this grant covers changed, so Google is not asked.
    if (kinds.length === 0) return { outcome: "synced", result: await eachKind(async () => nothing) };

    const [leased] = await db.update(table).set({ syncStartedAt: started }).where(and(key, live, idle(started), gate(started))).returning({ userId: table.userId });

    if (!leased) return refused(started);

    try {
      return await pullAndApply(row, started, window, kinds, reconciled);
    } finally {
      await db.update(table).set({ syncStartedAt: null }).where(and(key, eq(table.syncStartedAt, started)));
    }
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
      let providerUserId: string | null = null;

      // A sign-in may switch Google accounts, so the ID is read again. Google asks apps to confirm the account has a
      // Google Health profile before calling it connected. Any other failure leaves the ID for the next sync to fill.
      try {
        providerUserId = await provider.accountId(grant.accessToken);
      } catch (failure) {
        if (failure instanceof ProviderFailure && failure.reason === "not-linked") {
          await provider.revoke(grant.refreshToken);

          return "not-linked";
        }
      }

      const now = runtime.now();
      // A new grant may cover kinds never read, so it is not reconciled yet, and its first Sync now skips the cooldown.
      // Clearing the lease takes it from any sync still running on the old grant, so that run cannot save.
      const columns = { scope: grant.scope, ...grantColumns(grant, now), providerUserId, reconciledAt: null, syncStartedAt: null, lastError: null, updatedAt: now };

      await db.insert(wearableConnections).values({ userId, provider: provider.id, ...columns })
        .onConflictDoUpdate({ target: [wearableConnections.userId, wearableConnections.provider], set: columns });

      return "connected";
    },

    // A background import: the kinds and dates the scope names. Waits only for a sync already running.
    sync: (scope: SyncScope): Promise<SyncOutcome> => leasedSync(scope, () => undefined),

    // Sync now: everything, at most once per cooldown unless the grant is newer than the last sync.
    manualSync: (): Promise<SyncOutcome> => leasedSync(everything, cooled),

    // Revokes the provider's grant, then forgets the tokens and removes everything imported from it.
    async disconnect(): Promise<DisconnectResult> {
      const row = await stored();
      const revoked = row && isLive(row) ? await provider.revoke(tokens.open("refresh-token", row.refreshToken)) : false;

      const removed = await db.transaction(async (tx) => {
        // Deleting the row first locks it, so a sync still in flight finds nothing to write to.
        await tx.delete(wearableConnections).where(key);
        await tx.delete(wearableOauthStates).where(pendingStates);

        return removeImports(tx, owner);
      });

      return { revoked, removed };
    },
  };
}
