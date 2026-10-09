import { readdir, readFile } from "node:fs/promises";
import type { Sql } from "postgres";

const dbDirectory = new URL("../../db/", import.meta.url);

// db/schema.sql created the first deployed database. Later changes go in db/migrations as numbered files
// (0001-add-x.sql); each runs once, in name order, and schema_migrations records it.
async function migrationFiles(): Promise<{ name: string; url: URL }[]> {
  const later = await readdir(new URL("migrations/", dbDirectory)).catch(() => []);

  return [
    { name: "schema.sql", url: new URL("schema.sql", dbDirectory) },
    ...later.filter((file) => file.endsWith(".sql")).sort().map((file) => ({ name: `migrations/${file}`, url: new URL(`migrations/${file}`, dbDirectory) })),
  ];
}

export async function applyMigrations(client: Sql): Promise<void> {
  const files = await migrationFiles();

  await client.begin(async (sql) => {
    // Two deploys starting at once wait for each other instead of running a file twice.
    await sql`SELECT pg_advisory_xact_lock(hashtext('nouri-migrations'))`;
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const applied = new Set((await sql<{ name: string }[]>`SELECT name FROM schema_migrations`).map((row) => row.name));

    // A database made before migrations were recorded already has the schema; record it instead of failing on existing tables.
    if (!applied.has("schema.sql")) {
      const [existing] = await sql<{ found: boolean }[]>`SELECT to_regclass('users') IS NOT NULL AS found`;

      if (existing?.found) {
        await sql`INSERT INTO schema_migrations (name) VALUES ('schema.sql')`;
        applied.add("schema.sql");
      }
    }

    for (const file of files) {
      if (applied.has(file.name)) continue;
      await sql.unsafe(await readFile(file.url, "utf8"));
      await sql`INSERT INTO schema_migrations (name) VALUES (${file.name})`;
    }
  });
}
