import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createApp } from "../app.js";
import { applyMigrations } from "../db/migrations.js";
import type { WearableRuntime } from "../wearables/provider.js";

export function createHarness(wearables?: WearableRuntime) {
  const url = process.env.DATABASE_URL;

  if (!url) throw new Error("DATABASE_URL is required for integration tests");
  const schema = `nouri_test_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  const client = postgres(url, { max: 10, connection: { search_path: schema } });
  const userId = "11111111-1111-4111-8111-111111111111";
  const token = "test-token-with-at-least-thirty-two-characters";
  const db = drizzle(client);
  const app = createApp(db, { token, userId }, wearables);
  const otherApp = createApp(db, { token, userId: "22222222-2222-4222-8222-222222222222" });
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  return {
    app, otherApp, client, db, token, userId, headers,
    setup: async () => {
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      await applyMigrations(client);
    },
    cleanup: async () => {
      await client.end();
      await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
