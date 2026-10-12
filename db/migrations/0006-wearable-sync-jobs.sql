-- The provider's own ID for the person, which its change notifications name. Google Health calls it healthUserId.
ALTER TABLE wearable_connections ADD COLUMN provider_user_id text;
-- The last sync that re-read every granted kind over the whole window.
ALTER TABLE wearable_connections ADD COLUMN reconciled_at timestamptz;
-- The last time the person opened Nouri. Daily reconciliation only covers people who use it.
ALTER TABLE wearable_connections ADD COLUMN opened_at timestamptz;
-- Set while a sync reads from the provider, so one connection never has two syncs calling it at once.
-- A lease older than a few minutes belongs to a process that stopped and no longer counts.
ALTER TABLE wearable_connections ADD COLUMN sync_started_at timestamptz;

CREATE INDEX wearable_connections_provider_user_idx ON wearable_connections (provider, provider_user_id) WHERE provider_user_id IS NOT NULL;

-- At most one background import waits per connection. Every new request merges into it, so a burst of
-- notifications runs one sync. Removing the connection removes its job. The connection's sync_started_at, not
-- this table, keeps two syncs from running at once.
CREATE TABLE wearable_sync_jobs (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider text NOT NULL,
  kinds text[] NOT NULL CHECK (cardinality(kinds) > 0),
  -- The earliest UTC date that changed, or null to re-read the whole window.
  since date,
  -- How many requests merged into the job. One that arrives while the job runs may name data the run missed,
  -- so the worker removes the job only if the count is still what it read.
  requests integer NOT NULL DEFAULT 1,
  due_at timestamptz NOT NULL,
  -- Failed runs so far; each one pushes due_at further out.
  attempts integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, provider),
  FOREIGN KEY (user_id, provider) REFERENCES wearable_connections (user_id, provider) ON DELETE CASCADE
);

CREATE INDEX wearable_sync_jobs_due_idx ON wearable_sync_jobs (due_at);
