import { readFile } from "node:fs/promises";
import type { Sql } from "postgres";

// The app is not deployed yet, so one idempotent schema file replaces numbered migrations.
const schema = new URL("../../db/schema.sql", import.meta.url);

export async function applyMigrations(client: Sql): Promise<void> {
  await client.unsafe(await readFile(schema, "utf8"));
}
