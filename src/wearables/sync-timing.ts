const minute = 60_000;

const hour = 60 * minute;

// Every delay that paces syncs with a provider, the sync runner's and the background queue's alike.
export const syncTiming = {
  // A sync holds its connection this long at most. One that runs longer, or whose process stopped, no longer blocks the next.
  leaseMs: 5 * minute,
  // How long a sync that found another one running waits before trying again.
  busyRetryMs: 30_000,
  // Sync now runs at most once a minute per connection, so repeated clicks or scripts cannot multiply Google reads.
  manualCooldownMs: minute,
  // One phone upload sends several notifications over a few seconds. Waiting this long lets them share one sync.
  debounceMs: 30_000,
  // How old the last sync may be before opening Nouri queues another. Notifications keep imports current,
  // so with them this only catches what they missed. Without them (localhost), opening Nouri is what imports.
  staleAfterMs: { notified: 6 * hour, unnotified: 15 * minute },
  // A sync from an app open reads back this many days before the last one, for uploads that arrive late.
  lateDays: 3,
  // How often a full re-read runs for people who use Nouri, to catch notifications that never arrived.
  reconcileEveryMs: 24 * hour,
  activeWithinMs: 14 * 24 * hour,
  // How often the worker looks for connections due a reconciliation. Each look wakes a database that scales to zero.
  reconcileScanMs: 6 * hour,
  // How long the worker waits to look for due jobs again after it could not read when the next one is due.
  rescanAfterErrorMs: minute,
  retry: { firstMs: minute, maxMs: 6 * hour, attempts: 8 },
  // Jobs run one at a time, at most this many per read, so Google sees a steady trickle.
  batch: 5,
} as const;
