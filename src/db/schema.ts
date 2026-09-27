import { bigint, customType, date, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { FoodQuantity } from "../contracts.js";
import type { MeasurementKind } from "../measurements/contract.js";
import type { PhotoType } from "../photos/contract.js";
import type { Dose, Supplement, SupplementKind } from "../supplements/contract.js";
import type { SourceColumn, WearableProvider } from "../wearables/contract.js";
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
  source: text("source").$type<SourceColumn>().notNull().default("manual"),
  sourceId: text("source_id"),
  sourceFingerprint: text("source_fingerprint"),
  sourceDevice: text("source_device"),
  sourceTitle: text("source_title"),
}, (table) => [activeDayIndex("workouts", table), uniqueIndex("workouts_user_source_idx").on(table.userId, table.source, table.sourceId).where(sql`source_id IS NOT NULL`)]);

export const sleepSessions = pgTable("sleep_sessions", {
  ...journalColumns,
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
  awakeMinutes: integer("awake_minutes"),
  lightMinutes: integer("light_minutes"),
  deepMinutes: integer("deep_minutes"),
  remMinutes: integer("rem_minutes"),
  source: text("source").$type<SourceColumn>().notNull().default("manual"),
  sourceId: text("source_id"),
  sourceFingerprint: text("source_fingerprint"),
  sourceDevice: text("source_device"),
}, (table) => [activeDayIndex("sleep_sessions", table), uniqueIndex("sleep_sessions_user_source_idx").on(table.userId, table.source, table.sourceId).where(sql`source_id IS NOT NULL`)]);

export const wearableConnections = pgTable("wearable_connections", {
  userId: uuid("user_id").notNull(),
  provider: text("provider").$type<WearableProvider>().notNull(),
  scope: text("scope").notNull(),
  refreshToken: text("refresh_token"),
  accessToken: text("access_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.provider] })]);

export const wearableOauthStates = pgTable("wearable_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  provider: text("provider").$type<WearableProvider>().notNull(),
  codeVerifier: text("code_verifier").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const supplementStacks = pgTable("supplement_stacks", {
  userId: uuid("user_id").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  supplements: jsonb("supplements").$type<Supplement[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.effectiveFrom] })]);

export const supplementIntakes = pgTable("supplement_intakes", {
  ...journalColumns,
  ...occurredAtColumn,
  supplementId: uuid("supplement_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").$type<SupplementKind>().notNull(),
  dose: jsonb("dose").$type<Dose>().notNull(),
}, (table) => [activeDayIndex("supplement_intakes", table)]);

export const mutationReceipts = pgTable("mutation_receipts", {
  userId: uuid("user_id").notNull(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  outcome: text("outcome").$type<"created" | "updated" | "deleted" | "missing" | "stale" | "key-reuse">(),
  body: jsonb("body").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.key] })]);
