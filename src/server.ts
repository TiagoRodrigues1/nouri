import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { sweepExpired } from "./account/account.js";
import { createApp } from "./app.js";
import { openFoodFacts } from "./food/packaged.js";
import { wearablesFromEnv } from "./google-health/config.js";
import { identityFromEnv } from "./identity/identity.js";

const settings = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
  // The origin MCP clients reach, when a proxy hides it from requests. See docs/mcp-design.md.
  NOURI_PUBLIC_URL: z.url().transform((url) => new URL(url).origin).optional(),
}).parse(process.env);

const wearables = wearablesFromEnv(process.env, fetch);

const client = postgres(settings.DATABASE_URL);

const db = drizzle(client);

const app = createApp(db, identityFromEnv(process.env), openFoodFacts(fetch), wearables, settings.NOURI_PUBLIC_URL);

// A request that takes longer than two minutes to arrive, such as a stalled upload, gives its handler back.
const server = serve({ fetch: app.fetch, port: settings.PORT, hostname: settings.HOST, serverOptions: { requestTimeout: 120_000 } });

// Retry receipts and other short-lived rows expire by age. The Dockerfile runs one instance, so this process sweeps.
const sweep = () => void sweepExpired(db, new Date()).catch((failure: Error) => console.error(`Retention sweep failed: ${failure.message}`));

const sweeps = setInterval(sweep, 60 * 60_000);

sweep();

// Hosts stop the app with SIGTERM on each deploy; finish open requests before releasing the database connections.
process.once("SIGTERM", () => {
  clearInterval(sweeps);
  server.close(() => void client.end());
});
