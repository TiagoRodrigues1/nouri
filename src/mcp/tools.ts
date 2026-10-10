import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { AppDatabase } from "../db/database.js";
import { bodyMeasurements, foodEntries, sleepSessions, supplementIntakes, waterEntries, workouts } from "../db/schema.js";
import { getDated } from "../effective-dated.js";
import { searchFoods } from "../food/catalog.js";
import { catalogRefSchema, nutrientsSchema, positiveAmount } from "../food/contract.js";
import type { FoodEntry, SearchResult } from "../food/contract.js";
import type { Day } from "../days/contract.js";
import { getDay } from "../days/days.js";
import type { FoodItem } from "../food/food.js";
import { editFood, logFoods, mutateFood } from "../food/food.js";
import { mutateRecord } from "../journal/records.js";
import type { RecordKind } from "../journal/records.js";
import { fillDailyMeals, listMeals, logMeal } from "../meals/meals.js";
import { maxMealItems } from "../meals/contract.js";
import type { SavedMealList } from "../meals/contract.js";
import { measurementInputSchema, measurementKindSchema } from "../measurements/contract.js";
import type { Measurement, MeasurementSummary } from "../measurements/contract.js";
import { getMeasurementSummary, measurementRecords } from "../measurements/measurements.js";
import { sleepInputSchema, stagesSchema } from "../sleep/contract.js";
import type { SleepDay, SleepSession } from "../sleep/contract.js";
import { getSleepDay, sleepRecords } from "../sleep/sleep.js";
import { maxStackSize } from "../supplements/contract.js";
import type { SupplementIntake } from "../supplements/contract.js";
import type { TargetsForDay } from "../targets/contract.js";
import { intakeRecords, takeSupplements } from "../supplements/supplements.js";
import { targetsKind } from "../targets/targets.js";
import { instantAt, localDate, shiftDate, timeZoneSchema } from "../time.js";
import { waterInputSchema } from "../water/contract.js";
import type { WaterEntry } from "../water/contract.js";
import { waterRecords } from "../water/water.js";
import { activities, strengthExerciseSchema, workoutInputSchema } from "../workouts/contract.js";
import type { Workout, WorkoutDay } from "../workouts/contract.js";
import { getWorkoutDay, workoutRecords } from "../workouts/workouts.js";

const instructions = `Nouri is the person's food, training, and body journal. Log what they ate with log_meal, or log_saved_meal for a meal from list_saved_meals, and fix a logged food with edit_food.
Log training with log_workout, water with log_water, supplements from their stack with take_supplements, a night or nap with log_sleep, and weight, height, body fat, or waist with log_measurement.
Prefer a catalog food from search_foods when one matches; otherwise estimate the nutrients yourself and use null for any you cannot estimate.
Dates and times are the person's own wall clock. Leave them out for "now". Check your work with get_day, and remove a wrong entry with delete_entry.`;

// Journal records delete_entry removes besides food.
const recordKinds = ["workout", "water", "supplement", "sleep", "measurement"] as const;

const clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

const timeZone = timeZoneSchema.optional().describe("IANA zone such as Europe/Lisbon. Defaults to the zone of the person's latest entry; needed only for their first entry or while travelling.");

// Wall-clock fields shared by the log tools. The assistant never works out UTC offsets.
const when = {
  date: z.iso.date().optional().describe("Local date, YYYY-MM-DD. Defaults to today."),
  time: clock.optional().describe("Local time, HH:MM in 24 hours. Defaults to now, or noon when only a date is given."),
  timeZone,
};

const catalogItem = z.object({
  ref: catalogRefSchema.describe("A ref returned by search_foods."),
  grams: positiveAmount.max(10_000),
}).strict();

const estimatedItem = z.object({
  name: z.string().trim().min(1).max(200),
  amount: positiveAmount,
  unit: z.enum(["g", "ml"]),
  nutrients: nutrientsSchema.describe("For the whole amount, not per 100 g. Null when unknown."),
}).strict();

type Logged<Entry> = { date: string; timeZone: string; entries: Entry[] };

type ToolOutput =
  | SearchResult
  | Workout
  | WaterEntry
  | SleepSession
  | Measurement
  | SavedMealList
  | FoodEntry
  | Logged<FoodEntry>
  | Logged<SupplementIntake>
  | Day & { workouts: WorkoutDay; sleep: SleepDay; measurements: MeasurementSummary; targets: TargetsForDay }
  | { deleted: { kind: "food" | (typeof recordKinds)[number]; id: string } };

// Results go back as JSON text, which every MCP client shows to its model.
const text = (value: ToolOutput): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

const failure = (message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: message }] });

// The zone of the person's latest manual entry of any kind. Imported workouts and sleep may carry a bare UTC offset,
// so they are skipped.
async function latestZone(db: AppDatabase, userId: string): Promise<string | null> {
  const latest = (table: PgTable, manualOnly = false) => sql`(SELECT time_zone, created_at FROM ${table}
    WHERE user_id = ${userId} AND deleted_at IS NULL${manualOnly ? sql` AND source = 'manual'` : sql``} ORDER BY created_at DESC LIMIT 1)`;

  const [row] = await db.execute<{ time_zone: string }>(sql`SELECT time_zone FROM (
    ${latest(foodEntries)} UNION ALL ${latest(waterEntries)} UNION ALL ${latest(supplementIntakes)} UNION ALL ${latest(bodyMeasurements)}
    UNION ALL ${latest(workouts, true)} UNION ALL ${latest(sleepSessions, true)}
  ) AS entries ORDER BY created_at DESC LIMIT 1`);

  return row?.time_zone ?? null;
}

async function resolveWhen(db: AppDatabase, userId: string, input: { date?: string | undefined; time?: string | undefined; timeZone?: string | undefined }): Promise<{ occurredAt: string; timeZone: string } | null> {
  const timeZone = input.timeZone ?? await latestZone(db, userId);

  if (!timeZone) return null;
  const now = new Date().toISOString();

  if (input.date === undefined && input.time === undefined) return { occurredAt: now, timeZone };

  return { occurredAt: instantAt(input.date ?? localDate(now, timeZone), input.time ?? "12:00", timeZone), timeZone };
}

const noZone = failure("The person has no entries to take a time zone from. Ask for their time zone and pass timeZone.");

// Parses a record the way the REST API would, so its checks (ranges, sleep length) answer the assistant in words.
async function createRecord<Input, Entry extends ToolOutput>(db: AppDatabase, userId: string, kind: RecordKind<Input, Entry>, schema: z.ZodType<Input>, value: Input): Promise<CallToolResult> {
  const input = schema.safeParse(value);

  if (!input.success) return failure(input.error.issues.map((issue) => issue.message).join(" "));
  const result = await mutateRecord(db, userId, randomUUID(), kind, { kind: "create", input: input.data });

  if (result.outcome === "created") return text(result.entry);

  return failure(result.outcome === "unknown-reference" ? `${result.message}. Nothing was logged.` : `The ${kind.label.toLowerCase()} was not logged.`);
}

// Food has its own path, since it can also be edited.
const records: Record<(typeof recordKinds)[number], RecordKind<never, unknown>> = {
  workout: workoutRecords,
  water: waterRecords,
  supplement: intakeRecords,
  sleep: sleepRecords,
  measurement: measurementRecords,
};

async function currentRevision(db: AppDatabase, userId: string, table: PgTable, id: string): Promise<number | null> {
  const [row] = await db.execute<{ revision: number }>(sql`SELECT revision FROM ${table} WHERE user_id = ${userId} AND id = ${id} AND deleted_at IS NULL`);

  return row?.revision ?? null;
}

// A server for one signed-in person. Requests are stateless, so each builds its own.
export function nouriMcpServer(db: AppDatabase, userId: string): McpServer {
  const server = new McpServer({ name: "nouri", version: "1.0.0" }, { instructions });

  server.registerTool("search_foods", {
    title: "Search foods",
    description: "Search the Ciqual food composition table in English, French, or Portuguese words. Results have English names and nutrients per 100 g.",
    inputSchema: { query: z.string().trim().min(2).max(80) },
    annotations: { readOnlyHint: true },
  }, ({ query }) => text(searchFoods(query, "en")));

  server.registerTool("log_meal", {
    title: "Log a meal",
    description: "Log the foods of one meal, all at one time. Each item is a catalog food from search_foods in grams, or a food with your own nutrient estimate. Nothing is logged if any catalog ref is unknown.",
    inputSchema: { ...when, items: z.array(z.union([catalogItem, estimatedItem])).min(1).max(30) },
  }, async ({ items, ...time }) => {
    const at = await resolveWhen(db, userId, time);

    if (!at) return noZone;
    const foods: FoodItem[] = items.map((item) => "ref" in item ? item : { name: item.name, quantity: { amount: item.amount, unit: item.unit }, nutrients: item.nutrients, catalogRef: null });
    const result = await logFoods(db, userId, at, foods);

    if (result.outcome === "catalog-missing") return failure("A catalog ref is unknown. Use a ref exactly as search_foods returned it. Nothing was logged.");

    return text({ date: localDate(at.occurredAt, at.timeZone), timeZone: at.timeZone, entries: result.entries });
  });

  server.registerTool("log_workout", {
    title: "Log a workout",
    description: "Log one workout. Strength workouts list their exercises and have no distance; other activities have no exercises.",
    inputSchema: {
      ...when,
      activity: z.enum(activities),
      durationMinutes: z.number().int().min(1).max(1440),
      distanceM: z.number().int().min(1).max(1_000_000).optional().describe("Metres, for runs, walks, rides, and swims."),
      energyKcal: z.number().int().min(0).max(10_000).optional().describe("Only when a device or the person reported it."),
      exercises: z.array(strengthExerciseSchema).max(30).optional().describe("One row per exercise; weightKg null for bodyweight."),
    },
  }, async ({ date, time, timeZone, activity, durationMinutes, distanceM, energyKcal, exercises }) => {
    const at = await resolveWhen(db, userId, { date, time, timeZone });

    if (!at) return noZone;

    return createRecord(db, userId, workoutRecords, workoutInputSchema, { ...at, activity, durationMinutes, distanceM: distanceM ?? null, energyKcal: energyKcal ?? null, strengthExercises: exercises ?? null });
  });

  server.registerTool("log_water", {
    title: "Log water",
    description: "Log water the person drank, in millilitres.",
    inputSchema: { ...when, volumeMl: z.number().int().min(1).max(5000) },
  }, async ({ volumeMl, ...time }) => {
    const at = await resolveWhen(db, userId, time);

    return at ? createRecord(db, userId, waterRecords, waterInputSchema, { ...at, volumeMl }) : noZone;
  });

  server.registerTool("take_supplements", {
    title: "Take supplements",
    description: "Log supplements from the person's stack as taken, all at one time. Ids come from the supplements in get_day for that date. Nothing is logged if any id is not on that day's stack.",
    inputSchema: { ...when, supplementIds: z.array(z.uuid()).min(1).max(maxStackSize) },
  }, async ({ supplementIds, ...time }) => {
    const at = await resolveWhen(db, userId, time);

    if (!at) return noZone;
    const result = await takeSupplements(db, userId, at, supplementIds);

    if (result.outcome !== "created") return failure("A supplement is not on the person's stack for that day. Use ids from get_day. Nothing was logged.");

    return text({ date: localDate(at.occurredAt, at.timeZone), timeZone: at.timeZone, entries: result.entries });
  });

  server.registerTool("log_sleep", {
    title: "Log sleep",
    description: "Log one night or nap from bedtime to wake time. A bedtime later than the wake time is taken as the evening before.",
    inputSchema: {
      date: z.iso.date().optional().describe("Local date the person woke up, YYYY-MM-DD. Defaults to today."),
      bedtime: clock.describe("Local time asleep, HH:MM in 24 hours."),
      wakeTime: clock.describe("Local time awake, HH:MM in 24 hours."),
      timeZone,
      stages: stagesSchema.optional().describe("Minutes awake, light, deep, and REM, only when a device reported them."),
    },
  }, async ({ date, bedtime, wakeTime, timeZone: zone, stages }) => {
    const sleepZone = zone ?? await latestZone(db, userId);

    if (!sleepZone) return noZone;
    const woke = date ?? localDate(new Date().toISOString(), sleepZone);
    const slept = bedtime < wakeTime ? woke : shiftDate(woke, -1);

    return createRecord(db, userId, sleepRecords, sleepInputSchema, {
      startedAt: instantAt(slept, bedtime, sleepZone), endedAt: instantAt(woke, wakeTime, sleepZone), timeZone: sleepZone, stages: stages ?? null,
    });
  });

  server.registerTool("log_measurement", {
    title: "Log a measurement",
    description: "Log a body measurement: weight in kg, height in cm, body fat in percent, or waist in cm.",
    inputSchema: { ...when, kind: measurementKindSchema, value: z.number() },
  }, async ({ kind, value, ...time }) => {
    const at = await resolveWhen(db, userId, time);

    return at ? createRecord(db, userId, measurementRecords, measurementInputSchema, { ...at, kind, value }) : noZone;
  });

  server.registerTool("list_saved_meals", {
    title: "List saved meals",
    description: "The person's saved meals, newest first, each with its items and the amounts they were saved at.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => text(await listMeals(db, userId)));

  server.registerTool("log_saved_meal", {
    title: "Log a saved meal",
    description: "Log a meal from list_saved_meals, all at one time. Leave items out to log every item at its saved amount, or list the items to log with this time's amount in each item's own unit.",
    inputSchema: {
      ...when,
      mealId: z.uuid(),
      items: z.array(z.object({ id: z.uuid(), amount: positiveAmount.max(10_000) }).strict()).min(1).max(maxMealItems).optional(),
    },
  }, async ({ mealId, items, ...time }) => {
    const at = await resolveWhen(db, userId, time);

    if (!at) return noZone;
    const amounts = items ?? (await listMeals(db, userId)).meals.find((meal) => meal.id === mealId)?.items.map(({ id, food }) => ({ id, amount: food.quantity.amount }));

    if (!amounts) return failure("No saved meal with that id.");
    const result = await logMeal(db, userId, randomUUID(), mealId, { ...at, items: amounts });

    switch (result.outcome) {
      case "created":
        return text({ date: localDate(at.occurredAt, at.timeZone), timeZone: at.timeZone, entries: result.entry.entries });
      case "missing":
        return failure("No saved meal with that id.");
      default:
        return failure("An item is not in that meal, is listed twice, or its amount is too large. Nothing was logged.");
    }
  });

  server.registerTool("edit_food", {
    title: "Edit a food",
    description: "Change a logged food by the id log_meal, log_saved_meal, or get_day returned. Fields left out keep their value. A new amount scales the nutrients unless you also give nutrients. A date or time moves it on its own wall clock.",
    inputSchema: {
      id: z.uuid(),
      date: when.date.describe("Local date, YYYY-MM-DD."),
      time: when.time.describe("Local time, HH:MM in 24 hours."),
      name: z.string().trim().min(1).max(200).optional(),
      amount: positiveAmount.max(10_000).optional().describe("In the entry's own unit."),
      nutrients: nutrientsSchema.optional().describe("For the whole amount, not per 100 g. Null when unknown."),
    },
  }, async ({ id, ...edit }) => {
    const result = await editFood(db, userId, id, edit);

    switch (result.outcome) {
      case "updated":
        return text(result.entry);
      case "invalid-amount":
        return failure("That amount makes the nutrients too large. Nothing was changed.");
      case "stale":
        return failure("The entry changed while editing it. Try again.");
      default:
        return failure("No food entry with that id.");
    }
  });

  server.registerTool("get_day", {
    title: "Get a day",
    description: "Everything logged for a local day: foods and nutrient totals, water, the supplement stack with what was taken, workouts, the night's sleep (sleep belongs to the day it ended), measurements with the latest of each kind, and targets. A null total means nothing or something without that value was logged, not zero.",
    inputSchema: { date: when.date },
    annotations: { readOnlyHint: true },
  }, async ({ date }) => {
    const day = date ?? localDate(new Date().toISOString(), await latestZone(db, userId) ?? "UTC");

    // MCP sits outside /v1, so it brings daily meals up to date itself.
    await fillDailyMeals(db, userId);

    const [journal, workoutDay, sleep, measurements, targets] = await Promise.all([
      getDay(db, userId, day), getWorkoutDay(db, userId, day), getSleepDay(db, userId, day), getMeasurementSummary(db, userId, day), getDated(db, targetsKind, userId, day),
    ]);

    return text({ ...journal, workouts: workoutDay, sleep, measurements, targets });
  });

  server.registerTool("delete_entry", {
    title: "Delete an entry",
    description: "Remove an entry by the id a log tool or get_day returned. Workouts and sleep imported from a wearable cannot be removed here.",
    inputSchema: { kind: z.enum(["food", ...recordKinds]), id: z.uuid() },
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async ({ kind, id }) => {
    const record = kind === "food" ? null : records[kind];
    const revision = await currentRevision(db, userId, record?.table ?? foodEntries, id);

    if (revision === null) return failure(`No ${kind} entry with that id.`);
    const command = { kind: "delete" as const, id, revision };
    const result = record ? await mutateRecord(db, userId, randomUUID(), record, command) : await mutateFood(db, userId, randomUUID(), command);

    switch (result.outcome) {
      case "deleted":
        return text({ deleted: { kind, id } });
      case "stale":
        return failure("The entry changed while deleting it. Try again.");
      default:
        return failure(record?.deletable ? `That ${kind} was imported from a wearable and cannot be removed here.` : `No ${kind} entry with that id.`);
    }
  });

  return server;
}
