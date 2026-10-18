-- The assistants (MCP clients) a person has let in, by Clerk's OAuth client id. Clerk keeps the grants but cannot
-- list one person's, so Nouri notes each client on its first call. A disconnected client keeps its row until its
-- next call ends the grant at Clerk.
CREATE TABLE assistant_connections (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id text NOT NULL CHECK (length(client_id) BETWEEN 1 AND 200),
  name text CHECK (length(name) <= 256),
  connected_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  PRIMARY KEY (user_id, client_id)
);
