import postgres from "postgres";
import { applyMigrations } from "./migrations.js";

const url = process.env.DATABASE_URL;

if (!url) throw new Error("DATABASE_URL is required");

const client = postgres(url, { max: 1, onnotice: () => undefined });

try {
  await applyMigrations(client);
} finally {
  await client.end();
}
