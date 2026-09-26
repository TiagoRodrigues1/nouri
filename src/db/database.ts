import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

export type AppDatabase = PostgresJsDatabase<Record<string, never>>;

export type Transaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
