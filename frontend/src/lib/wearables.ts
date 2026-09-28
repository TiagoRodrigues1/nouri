import type { CallbackResult, ConnectionStatus, ImportKind, WearableProvider } from "./api";

// What the page calls each provider and where its data can be edited. Add an entry with each new provider.
export const providerDetails: Record<WearableProvider, { name: string; description: string; revokeHelp: string }> = {
  "google-health": { name: "Google Health", description: "Imports sleep and workouts from Fitbit devices, such as Fitbit Air, through your Google account.", revokeHelp: "Google did not confirm the revocation, so remove Nouri in your Google Account settings too." },
};

// The badge each connection state shows, in the Wearables dialog and on the Overview tiles.
export const connectionBadges: Record<ConnectionStatus["connection"], { label: string; variant: "secondary" | "outline" | "destructive" }> = {
  "not-configured": { label: "Not set up", variant: "outline" },
  "not-connected": { label: "Not connected", variant: "outline" },
  connected: { label: "Connected", variant: "secondary" },
  reauthorize: { label: "Sign in again", variant: "destructive" },
};

export const callbackMessages: Record<CallbackResult, string> = {
  connected: "Connected. Importing your sleep and workouts…",
  denied: "Access was not granted, so nothing was connected.",
  "expired-link": "That sign-in link expired or was opened in another browser. Choose Connect again.",
  "missing-scope": "Nouri needs permission to read sleep or exercise. Choose Connect again and allow at least one.",
  "token-failed": "Sign-in did not finish. Choose Connect to try again.",
};

// What each imported kind is called in counts, singular and plural.
export const importNouns: Record<ImportKind, [string, string]> = {
  sleep: ["sleep session", "sleep sessions"],
  workouts: ["workout", "workouts"],
};

export function noun(kind: ImportKind, count: number): string {
  const [one, many] = importNouns[kind];

  return count === 1 ? one : many;
}

export function countOf(kind: ImportKind, count: number): string {
  return `${count} ${noun(kind, count)}`;
}

const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function lastSync(lastSyncedAt: string | null): string {
  return lastSyncedAt ? when.format(new Date(lastSyncedAt)) : "Never";
}
