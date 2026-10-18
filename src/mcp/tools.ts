import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { AppDatabase } from "../db/database.js";
import { bodyMeasurements, foodEntries, sleepSessions, supplementIntakes, waterEntries, workouts } from "../db/schema.js";
import { getDated, saveDated } from "../effective-dated.js";
import { searchFoods } from "../food/catalog.js";
import { catalogRefSchema, nutrientsSchema, positiveAmount } from "../food/contract.js";
import type { FoodEntry, SearchResult, SubmittedFood } from "../food/contract.js";
import type { Day } from "../days/contract.js";
import { getDay } from "../days/days.js";
import type { FoodItem } from "../food/food.js";
import { editFood, logFoods, mutateFood } from "../food/food.js";
import { editRecord, mutateRecord } from "../journal/records.js";
import type { RecordKind } from "../journal/records.js";
import { fillDailyMeals, listMeals, logMeal, mutateMeal } from "../meals/meals.js";
import { everyDay, maxMealItems, mealInputSchema } from "../meals/contract.js";
import type { MealDaily, MealDailyInput, MealInput, MealItemInput, SavedMeal, SavedMealList } from "../meals/contract.js";
import { measurementInputSchema, measurementKindSchema } from "../measurements/contract.js";
import type { Measurement, MeasurementSummary } from "../measurements/contract.js";
import { getMeasurementSummary, measurementRecords } from "../measurements/measurements.js";
import { sleepInputSchema, stagesSchema } from "../sleep/contract.js";
import type { SleepDay, SleepSession } from "../sleep/contract.js";
import { getSleepDay, sleepRecords } from "../sleep/sleep.js";
import { maxStackSize, supplementSchema, supplementStackSchema } from "../supplements/contract.js";
import type { StackForDay, SupplementIntake } from "../supplements/contract.js";
import { targetsSchema } from "../targets/contract.js";
import type { TargetsForDay } from "../targets/contract.js";
import { intakeRecords, stackKind, takeSupplements } from "../supplements/supplements.js";
import { targetsKind } from "../targets/targets.js";
import { instantAt, localDate, localTime, shiftDate, timeZoneSchema } from "../time.js";
import { waterInputSchema } from "../water/contract.js";
import type { WaterEntry } from "../water/contract.js";
import { waterRecords } from "../water/water.js";
import type { LibraryExercise } from "../exercises/contract.js";
import { getExerciseLibrary } from "../exercises/exercises.js";
import { activities, exerciseKey, strengthExerciseSchema, workoutInputSchema } from "../workouts/contract.js";
import type { Workout, WorkoutDay } from "../workouts/contract.js";
import { getWorkoutDay, workoutRecords } from "../workouts/workouts.js";

const instructions = `Nouri is the person's food, training, and body journal. Log what they ate with log_meal, or log_saved_meal for a meal from list_saved_meals, and fix a logged food with edit_food.
Log training with log_workout, naming exercises as search_exercises finds them, water with log_water, supplements from their stack with take_supplements, a night or nap with log_sleep, and weight, height, body fat, or waist with log_measurement. Fix any of those with edit_entry.
Prefer a catalog food from search_foods when one matches; otherwise estimate the nutrients yourself and use null for any you cannot estimate.
Change the supplement stack with change_supplement_stack and daily targets with change_targets. Keep meals the person eats often with save_meal, and change or remove them with edit_saved_meal and delete_saved_meal.
Dates and times are the person's own wall clock. Leave them out for "now". Check your work with get_day, and remove a wrong entry with delete_entry.`;

// Journal records delete_entry removes besides food.
const recordKinds = ["workout", "water", "supplement", "sleep", "measurement"] as const;

// The fields edit_entry may change on each kind besides its date and time.
const editFields = {
  workout: ["activity", "durationMinutes", "distanceM", "energyKcal", "exercises"],
  water: ["volumeMl"],
  supplement: [],
  sleep: ["bedtime", "wakeTime", "stages"],
  measurement: ["value"],
} as const satisfies Record<(typeof recordKinds)[number], string[]>;

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

// A food already logged, copied into a saved meal at an amount.
const loggedItem = z.object({
  entryId: z.uuid().describe("A food id from get_day or a log tool."),
  amount: positiveAmount.max(10_000).describe("In the entry's own unit."),
}).strict();

const mealItem = z.union([catalogItem, estimatedItem, loggedItem]);

const dailyMeal = z.object({
  time: clock.describe("Local time the meal logs itself, HH:MM in 24 hours."),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional().describe("ISO weekdays, 1 Monday to 7 Sunday. Defaults to every day."),
  from: z.enum(["today", "tomorrow"]).optional().describe("When turning it on: \"tomorrow\" when today's is already logged, so today is not logged twice. Defaults to today."),
}).strict();

// A catalog or estimated item as the journal takes a food.
function submitted(item: z.infer<typeof catalogItem> | z.infer<typeof estimatedItem>): SubmittedFood {
  return "ref" in item
    ? { kind: "catalog", ref: item.ref, quantity: { amount: item.grams, unit: "g" } }
    : { name: item.name, quantity: { amount: item.amount, unit: item.unit }, nutrients: item.nutrients };
}

const mealItemInput = (item: z.infer<typeof mealItem>): MealItemInput => ("entryId" in item ? item : { food: submitted(item) });

type Logged<Entry> = { date: string; timeZone: string; entries: Entry[] };

type ToolOutput =
  | SearchResult
  | Workout
  | WaterEntry
  | SleepSession
  | Measurement
  | SavedMealList
  | SavedMeal
  | StackForDay
  | TargetsForDay
  | SupplementIntake
  | FoodEntry
  | Logged<FoodEntry>
  | Logged<SupplementIntake>
  | Day & { workouts: WorkoutDay; sleep: SleepDay; measurements: MeasurementSummary; targets: TargetsForDay }
  | { exercises: LibraryExercise[]; more: number }
  | { deleted: { kind: "food" | "saved-meal" | (typeof recordKinds)[number]; id: string } };

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

// The person's own date today, in the zone of their latest entry.
async function today(db: AppDatabase, userId: string): Promise<string> {
  return localDate(new Date().toISOString(), await latestZone(db, userId) ?? "UTC");
}

// An instant moved on its own wall clock and zone: a date or time left out keeps its own.
function moved(occurredAt: string, timeZone: string, date: string | undefined, time: string | undefined): string {
  if (date === undefined && time === undefined) return occurredAt;

  return instantAt(date ?? localDate(occurredAt, timeZone), time ?? localTime(occurredAt, timeZone), timeZone);
}

// A night or nap that ended on `woke`. A bedtime later than the wake time is the evening before.
function sleepSpan(woke: string, bedtime: string, wakeTime: string, zone: string) {
  const slept = bedtime < wakeTime ? woke : shiftDate(woke, -1);

  return { startedAt: instantAt(slept, bedtime, zone), endedAt: instantAt(woke, wakeTime, zone) };
}

// A sentence from a domain message, which may lack its full stop.
const sentence = (message: string) => message.replace(/\.?$/, ".");

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
// Deleting needs no input, so any kind fits; edit_entry picks each kind by name.
const records: Record<(typeof recordKinds)[number], Omit<RecordKind<never, unknown>, "edit">> = {
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

    const foods: FoodItem[] = items.map((item) => ({ food: submitted(item) }));

    const result = await db.transaction((tx) => logFoods(tx, userId, at, foods));

    // Only a catalog ref can fail: these items copy no entries and keep their own amounts.
    if (result.outcome !== "created") return failure("A catalog ref is unknown. Use a ref exactly as search_foods returned it. Nothing was logged.");

    return text({ date: localDate(at.occurredAt, at.timeZone), timeZone: at.timeZone, entries: result.entries });
  });

  server.registerTool("search_exercises", {
    title: "Search exercises",
    description: "Search the exercises the person picks from when logging strength training: the built-in catalog, their custom exercises, and names from their past workouts. Log exercises under these exact names so their history stays together.",
    inputSchema: { query: z.string().trim().min(2).max(80).describe("Words of the name, such as \"bench press\" or \"squat\".") },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => {
    const words = exerciseKey(query).split(" ");
    const { exercises } = await getExerciseLibrary(db, userId);

    // The person's own exercises first, since they are the names their history already uses.
    const matches = exercises.filter((exercise) => words.every((word) => exercise.key.includes(word)))
      .sort((a, b) => Number(a.origin === "catalog") - Number(b.origin === "catalog"));

    return text({ exercises: matches.slice(0, 25), more: Math.max(0, matches.length - 25) });
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
      exercises: z.array(strengthExerciseSchema).max(30).optional().describe("One row per exercise; weightKg null for bodyweight. Name each one as search_exercises returns it."),
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

    return createRecord(db, userId, sleepRecords, sleepInputSchema, { ...sleepSpan(woke, bedtime, wakeTime, sleepZone), timeZone: sleepZone, stages: stages ?? null });
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
    description: "The person's saved meals, most recently logged or saved first, each with its items, the amounts they were saved at, and the last day it was logged on.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    // The last day a daily meal is on counts today's fill.
    await fillDailyMeals(db, userId);

    return text(await listMeals(db, userId));
  });

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

  // A saved meal by id, as list_saved_meals shows it.
  const savedMeal = async (id: string) => (await listMeals(db, userId)).meals.find((meal) => meal.id === id);

  // Saves a meal the way the REST API would, so its checks answer the assistant in words.
  async function saveMeal(command: { kind: "create" } | { kind: "edit"; id: string; revision: number }, value: MealInput): Promise<CallToolResult> {
    const input = mealInputSchema.safeParse(value);

    if (!input.success) return failure(input.error.issues.map((issue) => sentence(issue.message)).join(" "));
    const result = await mutateMeal(db, userId, randomUUID(), { ...command, input: input.data });

    switch (result.outcome) {
      case "created":
      case "updated":
        return text(result.entry);
      case "missing":
        return failure(command.kind === "edit" ? "No saved meal with that id, or a logged food it copies is gone. Nothing was saved." : "A logged food it copies is gone. Nothing was saved.");
      case "catalog-missing":
        return failure("A catalog ref is unknown. Use a ref exactly as search_foods returned it. Nothing was saved.");
      case "stale":
        return failure("The meal changed while editing it. Try again.");
      default:
        return failure("An item is not in that meal, or its amount makes the nutrients too large. Nothing was saved.");
    }
  }

  // The meal's daily setting after a change: left out keeps it, null turns it off. A new time keeps the meal's
  // weekdays and zone unless given.
  async function dailySetting(change: z.infer<typeof dailyMeal> | null | undefined, current: MealDaily | null, zone: string | undefined): Promise<MealDailyInput | null | "no-zone"> {
    if (change === undefined) return current;

    if (change === null) return null;
    const timeZone = zone ?? current?.timeZone ?? await latestZone(db, userId);

    if (!timeZone) return "no-zone";

    const setting = { time: change.time, timeZone, weekdays: change.weekdays ?? current?.weekdays ?? [...everyDay] };

    return change.from ? { ...setting, from: change.from } : setting;
  }

  server.registerTool("save_meal", {
    title: "Save a meal",
    description: "Save a meal the person eats often, to log later with log_saved_meal. Each item is a catalog food from search_foods in grams, a food with your own nutrient estimate, or a logged food by its id at an amount. Give daily to have it log itself at that time on those weekdays, from today unless daily.from is \"tomorrow\".",
    inputSchema: {
      name: z.string().trim().min(1).max(80),
      items: z.array(mealItem).min(1).max(maxMealItems),
      daily: dailyMeal.optional(),
      timeZone,
    },
  }, async ({ name, items, daily, timeZone: zone }) => {
    const setting = await dailySetting(daily, null, zone);

    if (setting === "no-zone") return noZone;

    return saveMeal({ kind: "create" }, { name, items: items.map(mealItemInput), daily: setting });
  });

  server.registerTool("edit_saved_meal", {
    title: "Edit a saved meal",
    description: "Change a meal from list_saved_meals. Fields left out keep their value. Remove items or change their saved amounts by item id, and add new items as save_meal takes them. daily null stops it logging itself. Foods already logged from it do not change.",
    inputSchema: {
      mealId: z.uuid(),
      name: z.string().trim().min(1).max(80).optional(),
      add: z.array(mealItem).min(1).max(maxMealItems).optional(),
      remove: z.array(z.uuid()).min(1).max(maxMealItems).optional().describe("Item ids to remove."),
      amounts: z.array(z.object({ id: z.uuid(), amount: positiveAmount.max(10_000) }).strict()).min(1).max(maxMealItems).optional().describe("New saved amounts by item id, in each item's own unit."),
      daily: dailyMeal.nullable().optional(),
      timeZone,
    },
  }, async ({ mealId, name, add, remove, amounts, daily, timeZone: zone }) => {
    const meal = await savedMeal(mealId);

    if (!meal) return failure("No saved meal with that id.");
    const ids = new Set(meal.items.map((item) => item.id));
    const unknown = [...remove ?? [], ...(amounts ?? []).map((item) => item.id)].find((id) => !ids.has(id));

    if (unknown) return failure(`The meal has no item ${unknown}. Use item ids from list_saved_meals. Nothing was saved.`);
    const removed = new Set(remove);
    const amountOf = new Map((amounts ?? []).map((item) => [item.id, item.amount]));
    const setting = await dailySetting(daily, meal.daily, zone);

    if (setting === "no-zone") return noZone;

    return saveMeal({ kind: "edit", id: meal.id, revision: meal.revision }, {
      name: name ?? meal.name,
      items: [
        ...meal.items.filter((item) => !removed.has(item.id)).map((item) => ({ id: item.id, amount: amountOf.get(item.id) ?? item.food.quantity.amount })),
        ...(add ?? []).map(mealItemInput),
      ],
      daily: setting,
    });
  });

  server.registerTool("delete_saved_meal", {
    title: "Delete a saved meal",
    description: "Remove a meal from list_saved_meals. Foods already logged from it stay logged.",
    inputSchema: { mealId: z.uuid() },
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async ({ mealId }) => {
    const meal = await savedMeal(mealId);

    if (!meal) return failure("No saved meal with that id.");
    const result = await mutateMeal(db, userId, randomUUID(), { kind: "delete", id: meal.id, revision: meal.revision });

    switch (result.outcome) {
      case "deleted":
        return text({ deleted: { kind: "saved-meal", id: meal.id } });
      case "stale":
        return failure("The meal changed while deleting it. Try again.");
      default:
        return failure("No saved meal with that id.");
    }
  });

  server.registerTool("change_supplement_stack", {
    title: "Change the supplement stack",
    description: "Add, change, or remove supplements on the person's stack, the list they tick off each day. The change takes effect on the date and lasts until the next change already saved after it. Ids come from the supplements in get_day for that date.",
    inputSchema: {
      date: when.date.describe("Local date the change takes effect, YYYY-MM-DD. Defaults to today."),
      add: z.array(supplementSchema.omit({ id: true })).min(1).max(maxStackSize).optional(),
      change: z.array(supplementSchema.partial().required({ id: true })).min(1).max(maxStackSize).optional().describe("Fields left out keep their value."),
      remove: z.array(z.uuid()).min(1).max(maxStackSize).optional(),
    },
  }, async ({ date, add, change, remove }) => {
    const day = date ?? await today(db, userId);
    const { supplements } = await getDated(db, stackKind, userId, day);
    const ids = new Set(supplements.map((supplement) => supplement.id));
    const unknown = [...remove ?? [], ...(change ?? []).map((supplement) => supplement.id)].find((id) => !ids.has(id));

    if (unknown) return failure(`No supplement ${unknown} on the stack for ${day}. Use ids from get_day for that date. Nothing was changed.`);
    const removed = new Set(remove);
    const changes = new Map((change ?? []).map((supplement) => [supplement.id, supplement]));

    // Supplements keep their place and id, so intakes logged against them still count.
    const stack = supplementStackSchema.safeParse({
      supplements: [
        ...supplements.filter((supplement) => !removed.has(supplement.id)).map((supplement) => ({ ...supplement, ...changes.get(supplement.id) })),
        ...(add ?? []).map((supplement) => ({ id: randomUUID(), ...supplement })),
      ],
    });

    if (!stack.success) return failure(`${stack.error.issues.map((issue) => sentence(issue.message)).join(" ")} Nothing was changed.`);

    return text(await saveDated(db, stackKind, userId, day, stack.data));
  });

  server.registerTool("change_targets", {
    title: "Change targets",
    description: "Change the person's daily targets: energy, macros, water, steps, sleep, fasting, active energy, exercise minutes, workouts, and a goal weight. Targets left out keep their value. The change takes effect on the date and lasts until the next change already saved after it.",
    inputSchema: {
      date: when.date.describe("Local date the change takes effect, YYYY-MM-DD. Defaults to today."),
      ...targetsSchema.partial().shape,
      weightKg: targetsSchema.shape.weightKg.optional().describe("Goal weight in kg; null clears it."),
    },
  }, async ({ date, ...change }) => {
    const day = date ?? await today(db, userId);
    const { targets } = await getDated(db, targetsKind, userId, day);
    const input = targetsSchema.safeParse({ ...targets, ...change });

    if (!input.success) return failure(`${input.error.issues.map((issue) => `${issue.path.join(".")}: ${sentence(issue.message)}`).join(" ")} Nothing was changed.`);

    return text(await saveDated(db, targetsKind, userId, day, input.data));
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

  // Changes a journal record and answers the assistant in words.
  async function editEntry<Input, Entry extends ToolOutput>(kind: RecordKind<Input, Entry>, name: string, id: string, change: (current: Input) => Input): Promise<CallToolResult> {
    const result = await editRecord(db, userId, kind, id, change);

    switch (result.outcome) {
      case "updated":
        return text(result.entry);
      case "imported":
        return failure(`That ${name} was imported from a wearable and cannot be changed here.`);
      case "missing":
        return failure(`No ${name} entry with that id.`);
      default:
        return failure(`${sentence(result.message)} Nothing was changed.`);
    }
  }

  server.registerTool("edit_entry", {
    title: "Edit an entry",
    description: "Change a logged workout, water, supplement, sleep, or measurement by the id a log tool or get_day returned; for food use edit_food. Fields left out keep their value, and only the kind's own fields apply. A date or time moves it on its own wall clock. Workouts and sleep imported from a wearable cannot be changed here.",
    inputSchema: {
      kind: z.enum(recordKinds),
      id: z.uuid(),
      date: when.date.describe("Local date, YYYY-MM-DD. For sleep, the date the person woke up."),
      time: when.time.describe("Local time, HH:MM in 24 hours. Not for sleep."),
      volumeMl: z.number().int().min(1).max(5000).optional().describe("Water."),
      activity: z.enum(activities).optional().describe("Workout."),
      durationMinutes: z.number().int().min(1).max(1440).optional().describe("Workout."),
      distanceM: z.number().int().min(1).max(1_000_000).nullable().optional().describe("Workout, in metres; null clears it."),
      energyKcal: z.number().int().min(0).max(10_000).nullable().optional().describe("Workout; null clears it."),
      exercises: z.array(strengthExerciseSchema).max(30).nullable().optional().describe("Workout: the whole list, replacing the logged one. Name each one as search_exercises returns it."),
      bedtime: clock.optional().describe("Sleep: local time asleep, HH:MM in 24 hours."),
      wakeTime: clock.optional().describe("Sleep: local time awake, HH:MM in 24 hours."),
      stages: stagesSchema.nullable().optional().describe("Sleep: minutes awake, light, deep, and REM; null clears them."),
      value: z.number().optional().describe("Measurement, in its kind's unit."),
    },
    annotations: { idempotentHint: true },
  }, async ({ kind, id, date, time, ...fields }) => {
    const allowed: readonly string[] = editFields[kind];
    const misplaced = [...kind === "sleep" && time !== undefined ? ["time"] : [], ...Object.entries(fields).flatMap(([field, value]) => (value === undefined || allowed.includes(field) ? [] : [field]))];

    if (misplaced.length > 0) return failure(`${misplaced.join(", ")} cannot be changed on a ${kind}. Nothing was changed.`);
    const at = (current: { occurredAt: string; timeZone: string }) => moved(current.occurredAt, current.timeZone, date, time);
    const keep = <Value>(change: Value | undefined, current: Value) => (change === undefined ? current : change);

    switch (kind) {
      case "workout":
        return editEntry(workoutRecords, kind, id, (current) => ({
          ...current,
          occurredAt: at(current),
          activity: keep(fields.activity, current.activity),
          durationMinutes: keep(fields.durationMinutes, current.durationMinutes),
          distanceM: keep(fields.distanceM, current.distanceM),
          energyKcal: keep(fields.energyKcal, current.energyKcal),
          strengthExercises: keep(fields.exercises, current.strengthExercises),
        }));
      case "water":
        return editEntry(waterRecords, kind, id, (current) => ({ ...current, occurredAt: at(current), volumeMl: keep(fields.volumeMl, current.volumeMl) }));
      case "supplement":
        return editEntry(intakeRecords, kind, id, (current) => ({ ...current, occurredAt: at(current) }));
      case "measurement":
        return editEntry(measurementRecords, kind, id, (current) => ({ ...current, occurredAt: at(current), value: keep(fields.value, current.value) }));
      case "sleep":
        return editEntry(sleepRecords, kind, id, (current) => {
          const zone = current.timeZone;
          const retimed = date !== undefined || fields.bedtime !== undefined || fields.wakeTime !== undefined;

          const span = retimed
            ? sleepSpan(date ?? localDate(current.endedAt, zone), fields.bedtime ?? localTime(current.startedAt, zone), fields.wakeTime ?? localTime(current.endedAt, zone), zone)
            : { startedAt: current.startedAt, endedAt: current.endedAt };

          return { ...current, ...span, stages: keep(fields.stages, current.stages) };
        });
    }
  });

  server.registerTool("get_day", {
    title: "Get a day",
    description: "Everything logged for a local day: foods and nutrient totals, water, the supplement stack with what was taken, workouts, the night's sleep (sleep belongs to the day it ended), measurements with the latest of each kind, and targets. A null total means nothing or something without that value was logged, not zero.",
    inputSchema: { date: when.date },
    annotations: { readOnlyHint: true },
  }, async ({ date }) => {
    const day = date ?? await today(db, userId);

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
