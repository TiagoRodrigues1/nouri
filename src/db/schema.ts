import { bigint, customType, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import type { FoodQuantity } from "../contracts.js";
import type { MeasurementKind } from "../measurements/contract.js";
import type { PhotoType } from "../photos/contract.js";
import type { Activity, StrengthExercise } from "../workouts/contract.js";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const journalColumns = {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  timeZone: text("time_zone").notNull(),
  localDate: date("local_date").notNull(),
  revision: integer("revision").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const occurredAtColumn = { occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull() };

function activeDayIndex(name: string, table: { userId: AnyPgColumn; localDate: AnyPgColumn }) {
  return index(`${name}_user_day_active_idx`).on(table.userId, table.localDate).where(sql`deleted_at IS NULL`);
}

export const foodEntries = pgTable("food_entries", {
  ...journalColumns,
  ...occurredAtColumn,
  name: text("name").notNull(),
  quantity: jsonb("quantity").$type<FoodQuantity>().notNull(),
  kcalMilli: bigint("kcal_milli", { mode: "number" }),
  proteinMilli: bigint("protein_milli", { mode: "number" }),
  carbsMilli: bigint("carbs_milli", { mode: "number" }),
  fatMilli: bigint("fat_milli", { mode: "number" }),
  catalogRef: jsonb("catalog_ref").$type<{ provider: "ciqual" | "usda-fdc" | "portfir" | "open-food-facts"; id: string; version?: string | undefined } | null>(),
}, (table) => [activeDayIndex("food_entries", table)]);

export const waterEntries = pgTable("water_entries", {
  ...journalColumns,
  ...occurredAtColumn,
  volumeMl: integer("volume_ml").notNull(),
}, (table) => [activeDayIndex("water_entries", table)]);

export const bodyMeasurements = pgTable("body_measurements", {
  ...journalColumns,
  ...occurredAtColumn,
  kind: text("kind").$type<MeasurementKind>().notNull(),
  valueMilli: bigint("value_milli", { mode: "number" }).notNull(),
}, (table) => [index("body_measurements_user_kind_active_idx").on(table.userId, table.kind, table.localDate).where(sql`deleted_at IS NULL`)]);

export const workouts = pgTable("workouts", {
  ...journalColumns,
  ...occurredAtColumn,
  activity: text("activity").$type<Activity>().notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  distanceM: integer("distance_m"),
  energyKcal: integer("energy_kcal"),
  strengthExercises: jsonb("strength_exercises").$type<StrengthExercise[]>(),
}, (table) => [activeDayIndex("workouts", table)]);

export const sleepSessions = pgTable("sleep_sessions", {
  ...journalColumns,
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  awakeMinutes: integer("awake_minutes"),
  lightMinutes: integer("light_minutes"),
  deepMinutes: integer("deep_minutes"),
  remMinutes: integer("rem_minutes"),
}, (table) => [activeDayIndex("sleep_sessions", table)]);

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const progressPhotos = pgTable("progress_photos", {
  ...journalColumns,
  ...occurredAtColumn,
  contentType: text("content_type").$type<PhotoType>().notNull(),
  byteSize: integer("byte_size").notNull(),
  image: bytea("image").notNull(),
}, (table) => [activeDayIndex("progress_photos", table)]);

export const dashboardLayouts = pgTable("dashboard_layouts", {
  userId: uuid("user_id").primaryKey(),
  cards: text("cards").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userTargets = pgTable("user_targets", {
  userId: uuid("user_id").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  kcal: integer("kcal").notNull(),
  proteinG: integer("protein_g").notNull(),
  carbsG: integer("carbs_g").notNull(),
  fatG: integer("fat_g").notNull(),
  waterMl: integer("water_ml").notNull(),
  steps: integer("steps").notNull(),
  sleepMinutes: integer("sleep_minutes").notNull(),
  fastingHours: integer("fasting_hours").notNull(),
  burnedKcal: integer("burned_kcal").notNull(),
  exerciseMinutes: integer("exercise_minutes").notNull(),
  workouts: integer("workouts").notNull(),
  weightG: integer("weight_g"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.effectiveFrom] })]);

export const mutationReceipts = pgTable("mutation_receipts", {
  userId: uuid("user_id").notNull(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  outcome: text("outcome").$type<"created" | "updated" | "deleted" | "missing" | "stale" | "key-reuse">(),
  body: jsonb("body").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.key] })]);
