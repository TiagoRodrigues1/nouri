import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { createApp } from "./app.js";
import { wearablesFromEnv } from "./google-health/config.js";
import { identityFromEnv } from "./identity/identity.js";

const settings = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
}).parse(process.env);

const wearables = wearablesFromEnv(process.env, fetch);

const client = postgres(settings.DATABASE_URL);

const app = createApp(drizzle(client), identityFromEnv(process.env), wearables);

serve({ fetch: app.fetch, port: settings.PORT, hostname: settings.HOST });
