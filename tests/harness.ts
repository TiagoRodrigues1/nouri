import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/db/migrations.js";
import { openFoodFacts } from "../src/food/packaged.js";
import type { WearableRuntime } from "../src/wearables/provider.js";
import { FakeOpenFoodFacts } from "./fake-open-food-facts.js";

// pk_test_ followed by base64 of "example.clerk.accounts.dev$", the shape Clerk issues.
export const publishableKey = `pk_test_${Buffer.from("example.clerk.accounts.dev$").toString("base64")}`;

export function createHarness(wearables?: WearableRuntime) {
  const url = process.env.DATABASE_URL;

  if (!url) throw new Error("DATABASE_URL is required for integration tests");
  const schema = `nouri_test_${randomUUID().replaceAll("-", "")}`;
  const admin = postgres(url, { max: 1, onnotice: () => undefined });
  const client = postgres(url, { max: 10, connection: { search_path: schema } });
  const userId = "11111111-1111-4111-8111-111111111111";
  const otherUserId = "22222222-2222-4222-8222-222222222222";
  const token = "test-session-token";
  const agentToken = "test-oauth-token";
  const db = drizzle(client);

  // Stands in for Clerk: the test tokens sign in as whichever Clerk user the app was built for.
  const identity = (clerkUserId: string) => ({
    authenticate: async (request: Request) => request.headers.get("Authorization") === `Bearer ${token}` ? clerkUserId : null,
    authenticateAgent: async (request: Request) => request.headers.get("Authorization") === `Bearer ${agentToken}` ? clerkUserId : null,
    publishableKey,
  });

  const products = new FakeOpenFoodFacts();
  const packagedFoods = openFoodFacts(products.fetch);
  const app = createApp(db, identity("user_test_1"), packagedFoods, wearables);
  const otherApp = createApp(db, identity("user_test_2"), packagedFoods);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  return {
    app, otherApp, client, db, token, agentToken, userId, headers, products,
    signedInAs: (clerkUserId: string) => createApp(db, identity(clerkUserId), packagedFoods, wearables),
    setup: async () => {
      await admin.unsafe(`CREATE SCHEMA "${schema}"`);
      await applyMigrations(client);
      await client`INSERT INTO users (id, clerk_user_id) VALUES (${userId}, 'user_test_1'), (${otherUserId}, 'user_test_2')`;
    },
    cleanup: async () => {
      await client.end();
      await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
