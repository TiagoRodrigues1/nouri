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
  // A JWT-format access token, which Clerk cannot revoke, issued to a second client.
  const jwtAgentToken = "test.jwt.token";
  const webhookSignature = "test-webhook-signature";
  const db = drizzle(client);

  // Grants Clerk has ended, by the token the test sent. Clearing it stands in for the person letting the client in again.
  const revokedAgentTokens = new Set<string>();

  // Stands in for Clerk: the test tokens sign in as whichever Clerk user the app was built for, through one OAuth client.
  const identity = (clerkUserId: string) => ({
    authenticate: async (request: Request) => request.headers.get("Authorization") === `Bearer ${token}` ? clerkUserId : null,
    authenticateAgent: async (request: Request) => {
      const header = request.headers.get("Authorization");

      if (header === `Bearer ${jwtAgentToken}`) return { clerkUserId, clientId: "client_chatgpt", revocable: false };

      return header === `Bearer ${agentToken}` && !revokedAgentTokens.has(agentToken) ? { clerkUserId, clientId: "client_claude", revocable: true } : null;
    },
    agentName: async (clientId: string) => clientId === "client_claude" ? "Claude" : null,
    revokeAgent: async (_clientId: string, revoked: string) => {
      revokedAgentTokens.add(revoked);
    },
    // Stands in for Clerk's signed webhook: the test signature passes, and a user.deleted body names the user.
    readWebhook: async (request: Request) => {
      if (request.headers.get("Webhook-Signature") !== webhookSignature) return "forged" as const;
      const event: { type?: string; data?: { id?: string } } = await request.json();

      return { deletedUser: event.type === "user.deleted" ? event.data?.id ?? null : null };
    },
    publishableKey,
  });

  const products = new FakeOpenFoodFacts();
  const packagedFoods = openFoodFacts(products.fetch);
  const app = createApp(db, identity("user_test_1"), packagedFoods, wearables);
  const otherApp = createApp(db, identity("user_test_2"), packagedFoods);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  return {
    app, otherApp, client, db, token, agentToken, jwtAgentToken, revokedAgentTokens, webhookSignature, userId, otherUserId, headers, products,
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
