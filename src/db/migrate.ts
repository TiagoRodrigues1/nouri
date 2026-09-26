import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const url = process.env.DATABASE_URL;

if (!url) throw new Error("DATABASE_URL is required");

const client = postgres(url, { max: 1 });

try {
  const path = fileURLToPath(new URL("../../db/migrations/0001_food_entries.sql", import.meta.url));
  await client.unsafe(await readFile(path, "utf8"));
} finally {
  await client.end();
}
