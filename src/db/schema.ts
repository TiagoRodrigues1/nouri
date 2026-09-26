import { bigint, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import type { FoodQuantity } from "../contracts.js";
import type { FoodEntry } from "../food/contract.js";
import { sql } from "drizzle-orm";

export const foodEntries = pgTable("food_entries", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  timeZone: text("time_zone").notNull(),
  localDate: date("local_date").notNull(),
  name: text("name").notNull(),
  quantity: jsonb("quantity").$type<FoodQuantity>().notNull(),
  kcalMilli: bigint("kcal_milli", { mode: "number" }),
  proteinMilli: bigint("protein_milli", { mode: "number" }),
  carbsMilli: bigint("carbs_milli", { mode: "number" }),
  fatMilli: bigint("fat_milli", { mode: "number" }),
  catalogRef: jsonb("catalog_ref").$type<{ provider: "ciqual" | "usda-fdc" | "portfir" | "open-food-facts"; id: string; version?: string | undefined } | null>(),
  revision: integer("revision").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("food_entries_user_day_active_idx").on(table.userId, table.localDate).where(sql`deleted_at IS NULL`)]);

export const mutationReceipts = pgTable("mutation_receipts", {
  userId: uuid("user_id").notNull(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  outcome: text("outcome").$type<"created" | "updated" | "deleted" | "missing" | "stale" | "key-reuse">(),
  body: jsonb("body").$type<FoodEntry | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.key] })]);
