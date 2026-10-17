import { z } from "zod";

// Every source Nouri imports from. Apple Health and Health Connect join this list with their adapters,
// together with the source checks on sleep_sessions, workouts, daily_activity, and daily_heart_rate in db/schema.sql.
export const wearableProviders = ["google-health"] as const;

export type WearableProvider = (typeof wearableProviders)[number];

export const wearableProviderSchema = z.enum(wearableProviders);

// A journal row is manual or belongs to the provider it was imported from.
export type SourceColumn = "manual" | WearableProvider;

// Imported rows name the provider and device they came from; Nouri never edits them.
export const recordSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("manual") }),
  z.object({ kind: z.literal("wearable"), provider: wearableProviderSchema, device: z.string().nullable() }),
]);

// What a provider can import. Each kind needs a scope, so a grant may cover only some of them.
// Sleep and workouts are sessions; activity (steps and active energy) and heart rate are totals per local day.
export const importKinds = ["sleep", "workouts", "activity", "heartRate"] as const;

export type ImportKind = (typeof importKinds)[number];

export const importKindSchema = z.enum(importKinds);

// What each kind covers, in messages to the person.
export const importKindNames: Record<ImportKind, string> = {
  sleep: "sleep",
  workouts: "workouts",
  activity: "steps and active energy",
  heartRate: "heart rate",
};

// The compiler checks the keys against importKinds, so a new kind cannot be left out of the API.
const perKind = <T extends z.ZodType>(schema: T) => z.object({ sleep: schema, workouts: schema, activity: schema, heartRate: schema } satisfies Record<ImportKind, T>);

export const connectionStates = ["not-configured", "not-connected", "connected", "reauthorize"] as const;

export const connectionStatusSchema = z.object({
  provider: wearableProviderSchema,
  connection: z.enum(connectionStates),
  // The last sync that finished; a failed attempt leaves it unchanged.
  lastSyncedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
  // The kinds the stored grant covers; empty unless connected.
  granted: z.array(importKindSchema),
  imported: perKind(z.number().int()),
  // Days of history each sync re-reads, or null when not configured.
  windowDays: z.number().int().nullable(),
});

// Whether stored imports are current. The page shows them right away and reloads them when lastSyncedAt moves.
export const syncStateSchema = z.object({
  // A background import is queued or running. One waiting out a failure is not pending; lastError says why.
  pending: z.boolean(),
  lastSyncedAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),
});

export const importCountsSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  // Records that could not become a Nouri entry, such as sleep longer than 24 hours. Daily kinds count days.
  skipped: z.number().int(),
});

// A kind the grant does not cover reports zeros.
export const syncResultSchema = perKind(importCountsSchema);

export const disconnectResultSchema = z.object({ revoked: z.boolean(), removed: perKind(z.number().int()) });

export const authorizationSchema = z.object({ authorizationUrl: z.url() });

// The OAuth callback reports its outcome to the page through the `connect` query parameter.
export const callbackResults = ["connected", "denied", "expired-link", "missing-scope", "not-linked", "token-failed"] as const;

export type CallbackResult = (typeof callbackResults)[number];

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export type ImportCounts = z.infer<typeof importCountsSchema>;

export type SyncState = z.infer<typeof syncStateSchema>;

export type SyncResult = z.infer<typeof syncResultSchema>;

export type DisconnectResult = z.infer<typeof disconnectResultSchema>;
