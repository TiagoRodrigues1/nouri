import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";

// $client reaches the postgres.js connection for what Drizzle lacks, such as cursors.
export type AppDatabase = PostgresJsDatabase<Record<string, never>> & { $client: Sql };

export type Transaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
