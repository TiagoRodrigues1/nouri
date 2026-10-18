import { bigint, boolean, customType, date, integer, jsonb, smallint, pgTable, primaryKey, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import type { Equipment, Muscle } from "../exercises/contract.js";
import type { FoodProvider, FoodQuantity } from "../food/contract.js";
import type { StoredMealItem } from "../meals/contract.js";
import type { MeasurementKind } from "../measurements/contract.js";
import type { PhotoType } from "../photos/contract.js";
import type { Profile } from "../profile/contract.js";
import type { RoutineExercise } from "../routines/contract.js";
import type { Dose, Supplement, SupplementKind } from "../supplements/contract.js";
import type { SourceColumn, WearableProvider } from "../wearables/contract.js";
import type { Activity, StrengthExercise } from "../workouts/contract.js";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

// Each person's records reference their users row, so deleting it erases them.
const ownerColumn = () => uuid("user_id").notNull().references((): AnyPgColumn => users.id, { onDelete: "cascade" });

const journalColumns = {
  id: uuid("id").primaryKey(),
  userId: ownerColumn(),
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
  catalogRef: jsonb("catalog_ref").$type<{ provider: FoodProvider; id: string; version?: string | undefined } | null>(),
  mealLogId: uuid("meal_log_id").references((): AnyPgColumn => mealLogs.id, { onDelete: "set null" }),
}, (table) => [
  activeDayIndex("food_entries", table),
  index("food_entries_meal_log_idx").on(table.mealLogId).where(sql`meal_log_id IS NOT NULL`),
]);

// Foods added from a label, seen by everyone once reviewed and by the person who added them before. Nutrients and
// the serving are thousandths of the label's values per 100 of `unit`. An erased account leaves its foods unowned.
export const communityFoods = pgTable("community_foods", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").references((): AnyPgColumn => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  brand: text("brand"),
  barcode: text("barcode"),
  unit: text("unit").$type<"g" | "ml">().notNull(),
  kcalMilli: bigint("kcal_milli", { mode: "number" }),
  proteinMilli: bigint("protein_milli", { mode: "number" }),
  carbsMilli: bigint("carbs_milli", { mode: "number" }),
  fatMilli: bigint("fat_milli", { mode: "number" }),
  servingMilli: bigint("serving_milli", { mode: "number" }),
  searchText: text("search_text").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("community_foods_reviewed_barcode_idx").on(table.barcode).where(sql`reviewed_at IS NOT NULL`),
  uniqueIndex("community_foods_user_barcode_idx").on(table.userId, table.barcode),
  index("community_foods_pending_idx").on(table.createdAt).where(sql`reviewed_at IS NULL`),
]);

export const savedMeals = pgTable("saved_meals", {
  id: uuid("id").primaryKey(),
  userId: ownerColumn(),
  name: text("name").notNull(),
  items: jsonb("items").$type<StoredMealItem[]>().notNull(),
  dailyTime: text("daily_time"),
  dailyTimeZone: text("daily_time_zone"),
  dailyFilledThrough: date("daily_filled_through"),
  dailyWeekdays: smallint("daily_weekdays").array(),
  revision: integer("revision").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("saved_meals_user_active_idx").on(table.userId, table.createdAt).where(sql`deleted_at IS NULL`),
  index("saved_meals_user_daily_idx").on(table.userId).where(sql`daily_time IS NOT NULL AND deleted_at IS NULL`),
]);

// One logging of a saved meal, by hand or as one day of a daily fill, named as the meal was then.
export const mealLogs = pgTable("meal_logs", {
  id: uuid("id").primaryKey(),
  userId: ownerColumn(),
  savedMealId: uuid("saved_meal_id").notNull().references((): AnyPgColumn => savedMeals.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  daily: boolean("daily").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("meal_logs_user_active_idx").on(table.userId, table.savedMealId, table.createdAt).where(sql`deleted_at IS NULL`),
]);

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

export const customExercises = pgTable("custom_exercises", {
  id: uuid("id").primaryKey(),
  userId: ownerColumn(),
  name: text("name").notNull(),
  key: text("key").notNull(),
  muscle: text("muscle").$type<Muscle>().notNull(),
  equipment: text("equipment").$type<Equipment>(),
  revision: integer("revision").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [uniqueIndex("custom_exercises_user_key_active_idx").on(table.userId, table.key).where(sql`deleted_at IS NULL`)]);

export const workoutRoutines = pgTable("workout_routines", {
  id: uuid("id").primaryKey(),
  userId: ownerColumn(),
  name: text("name").notNull(),
  exercises: jsonb("exercises").$type<RoutineExercise[]>().notNull(),
  revision: integer("revision").notNull().default(1),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("workout_routines_user_active_idx").on(table.userId, table.createdAt).where(sql`deleted_at IS NULL`)]);

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

const dailyTotalColumns = {
  userId: ownerColumn(),
  localDate: date("local_date").notNull(),
  source: text("source").$type<WearableProvider>().notNull(),
  sourceFingerprint: text("source_fingerprint").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const dailyActivity = pgTable("daily_activity", {
  ...dailyTotalColumns,
  steps: integer("steps"),
  activeKcal: integer("active_kcal"),
}, (table) => [primaryKey({ columns: [table.userId, table.localDate, table.source] })]);

export const dailyHeartRate = pgTable("daily_heart_rate", {
  ...dailyTotalColumns,
  restingBpm: integer("resting_bpm"),
  averageBpm: integer("average_bpm"),
  minBpm: integer("min_bpm"),
  maxBpm: integer("max_bpm"),
}, (table) => [primaryKey({ columns: [table.userId, table.localDate, table.source] })]);

export const wearableConnections = pgTable("wearable_connections", {
  userId: ownerColumn(),
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
  userId: ownerColumn(),
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
  thumbnail: bytea("thumbnail"),
}, (table) => [activeDayIndex("progress_photos", table)]);

export const dashboardLayouts = pgTable("dashboard_layouts", {
  userId: ownerColumn().primaryKey(),
  cards: text("cards").array().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const userTargets = pgTable("user_targets", {
  userId: ownerColumn(),
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

export const userProfiles = pgTable("user_profiles", {
  userId: ownerColumn().primaryKey(),
  sex: text("sex").$type<Profile["sex"]>().notNull(),
  birthYear: integer("birth_year").notNull(),
  activity: text("activity").$type<Profile["activity"]>().notNull(),
  goal: text("goal").$type<Profile["goal"]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const supplementStacks = pgTable("supplement_stacks", {
  userId: ownerColumn(),
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
  userId: ownerColumn(),
  key: text("key").notNull(),
  requestHash: text("request_hash").notNull(),
  outcome: text("outcome").$type<"created" | "updated" | "deleted" | "missing" | "stale" | "key-reuse">(),
  body: jsonb("body").$type<unknown>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [primaryKey({ columns: [table.userId, table.key] }), index("mutation_receipts_created_idx").on(table.createdAt)]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Clerk users whose account was erased; a session token issued before the erasure cannot create a new account.
export const erasedUsers = pgTable("erased_users", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  erasedAt: timestamp("erased_at", { withTimezone: true }).notNull().defaultNow(),
});

// The assistants (MCP clients such as Claude or ChatGPT) a person has let in, by Clerk's OAuth client id, so the
// page can list and disconnect them. Clerk keeps the grants but cannot list one person's, so Nouri notes each
// client on its first call. A disconnected client keeps its row until its next call ends the grant at Clerk.
export const assistantConnections = pgTable("assistant_connections", {
  userId: ownerColumn(),
  clientId: text("client_id").notNull(),
  name: text("name"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  // False while the client's access tokens are JWTs, which Clerk cannot revoke, so the page cannot disconnect it.
  revocable: boolean("revocable").notNull().default(true),
  disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
}, (table) => [primaryKey({ columns: [table.userId, table.clientId] })]);
