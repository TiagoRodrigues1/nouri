import { z } from "zod";

// Every source Nouri imports from. Apple Health and Health Connect join this list with their adapters,
// together with the sleep_sessions.source and workouts.source checks in db/schema.sql.
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

// What a provider can import. Each kind has its own scope, so a grant may cover only some of them.
export const importKinds = ["sleep", "workouts"] as const;

export type ImportKind = (typeof importKinds)[number];

export const importKindSchema = z.enum(importKinds);

const perKind = <T extends z.ZodType>(schema: T) => z.object({ sleep: schema, workouts: schema });

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

export const importCountsSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  removed: z.number().int(),
  // Records that could not become a Nouri entry, such as sleep longer than 24 hours.
  skipped: z.number().int(),
});

// A kind the grant does not cover reports zeros.
export const syncResultSchema = perKind(importCountsSchema);

export const disconnectResultSchema = z.object({ revoked: z.boolean(), removed: perKind(z.number().int()) });

export const authorizationSchema = z.object({ authorizationUrl: z.url() });

// The OAuth callback reports its outcome to the page through the `connect` query parameter.
export const callbackResults = ["connected", "denied", "expired-link", "missing-scope", "token-failed"] as const;

export type CallbackResult = (typeof callbackResults)[number];

export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export type ImportCounts = z.infer<typeof importCountsSchema>;

export type SyncResult = z.infer<typeof syncResultSchema>;

export type DisconnectResult = z.infer<typeof disconnectResultSchema>;
