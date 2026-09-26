import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { z } from "zod";
import { createApp } from "./app.js";

const settings = z.object({
  DATABASE_URL: z.string().min(1),
  API_TOKEN: z.string().min(32),
  API_USER_ID: z.uuid(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().min(1).default("127.0.0.1"),
}).parse(process.env);

const client = postgres(settings.DATABASE_URL);

const app = createApp(drizzle(client), { token: settings.API_TOKEN, userId: settings.API_USER_ID });

serve({ fetch: app.fetch, port: settings.PORT, hostname: settings.HOST });
