import type { BpmRange } from "../daily-totals/contract.js";
import type { Stages } from "../sleep/contract.js";
import type { Activity } from "../workouts/contract.js";
import { importKinds, type ImportKind, type WearableProvider } from "./contract.js";

export type OAuthGrant = { accessToken: string; refreshToken: string | null; expiresInSeconds: number; scope: string };

// What every imported record carries, whatever its kind.
type ImportedRecord = {
  // Changes whenever anything Nouri stores changes, so a correction without a new revision still lands.
  fingerprint: string;
  localDate: string;
};

// A session the provider names, such as a night or a workout.
type SessionRecord = ImportedRecord & {
  // The provider's stable ID, such as a Google Health data point name or a HealthKit sample UUID.
  externalId: string;
  // An IANA zone when the provider knows it, otherwise a fixed offset like "-04:00".
  timeZone: string;
  device: string | null;
};

// One sleep session as a provider reports it, already normalized to Nouri's units.
export type SleepRecord = SessionRecord & {
  startedAt: Date;
  endedAt: Date;
  stages: Stages | null;
};

// One workout as a provider reports it. It belongs to the local date it started on.
export type WorkoutRecord = SessionRecord & {
  occurredAt: Date;
  activity: Activity;
  // The provider's own name for the session, such as "Morning Trail Run" or "Yoga".
  title: string | null;
  durationMinutes: number;
  distanceM: number | null;
  energyKcal: number | null;
};

// A local day's steps and active energy. Daily totals carry no ID of their own; the date is their identity.
export type ActivityRecord = ImportedRecord & {
  steps: number | null;
  activeKcal: number | null;
};

// A local day's resting heart rate and the range over the day, in beats per minute.
export type HeartRateRecord = ImportedRecord & {
  restingBpm: number | null;
  range: BpmRange | null;
};

export type ImportRecords = { sleep: SleepRecord; workouts: WorkoutRecord; activity: ActivityRecord; heartRate: HeartRateRecord };

// A complete pull reports every record in the window, so absence means deletion.
export type Pull<R> = { records: R[]; complete: boolean; skipped: number };

// Local dates from `from` up to, not including, `until`.
export type DayRange = { from: string; until: string };

// The history each sync re-reads. Sleep is read by when it ended. Workouts are read by the local date they
// started, because Google only filters exercise by civil start time, and daily totals by their local date.
export type SyncWindow = { endedSince: Date; days: DayRange };

// What one sync reads: some kinds, from a UTC date on or, when since is null, over the whole window.
export type SyncScope = { kinds: readonly ImportKind[]; since: string | null };

// Every kind over the whole window: what Sync now and reconciliation read.
export const everything: SyncScope = { kinds: importKinds, since: null };

// A provider's notice that some of a person's records of one kind changed, from `since` on (null when it does not say).
export type ChangeNotice = { accountId: string; kind: ImportKind; since: string | null };

// How a provider tells Nouri about changes, when the server is set up to receive them.
export type ProviderWebhook = {
  // Whether the Authorization header carries the secret the provider was registered with.
  authorized: (authorization: string | undefined) => boolean;
  // "verification" for the provider's endpoint check; otherwise the changes the request names, without any it cannot read.
  read: (request: Request) => Promise<ChangeNotice[] | "verification">;
};

export function oauthCallbackPath(provider: string): string {
  return `/oauth/${provider}/callback`;
}

export const reauthorizeMessage = "Access expired or was revoked. Choose Connect to sign in again.";

// The messages reach the person, so they say what to do next, and none may carry a token.
// "unauthorized" means the provider refused the access token; a refreshed one may still work.
// "reauthorize" means the grant itself is gone and only a new sign-in helps.
export class ProviderFailure extends Error {
  constructor(readonly reason: "reauthorize" | "unauthorized" | "unavailable", message: string) { super(message); }
}

// A service Nouri's server signs in to with OAuth and pulls records from. Nouri owns the state, PKCE,
// token storage, and applying records; the provider only speaks its own HTTP API. Device-only sources
// such as HealthKit do not fit here: a native app reads them and uploads its records instead.
export type CloudProvider = {
  id: WearableProvider;
  // Each sync re-reads this many days, so edits and deletions inside it reach Nouri.
  windowDays: number;
  // Where the provider sends the browser back. The state cookie only exists on this origin.
  callbackOrigin: string;
  authorizationUrl: (state: string, codeChallenge: string) => string;
  exchangeCode: (code: string, codeVerifier: string) => Promise<OAuthGrant>;
  refresh: (refreshToken: string) => Promise<OAuthGrant>;
  // People can untick scopes on a consent screen, so a sync only pulls the kinds the stored grant covers.
  grantedKinds: (scope: string) => ImportKind[];
  revoke: (token: string) => Promise<boolean>;
  // The provider's ID for the signed-in person, which its change notifications name.
  accountId: (accessToken: string) => Promise<string>;
  // Null when this server receives no notifications; then only app opens and reconciliation start imports.
  webhook: ProviderWebhook | null;
  pull: { [K in ImportKind]: (accessToken: string, window: SyncWindow) => Promise<Pull<ImportRecords[K]>> };
};

export type WearableRuntime = {
  // 32 bytes for AES-256-GCM; provider tokens are stored encrypted with it.
  tokenKey: Buffer;
  now: () => Date;
  providers: CloudProvider[];
};
