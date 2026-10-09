import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { AppDatabase } from "../db/database.js";
import { foodEntries, workouts } from "../db/schema.js";
import { getDated } from "../effective-dated.js";
import { searchFoods } from "../food/catalog.js";
import { catalogRefSchema, nutrientsSchema, positiveAmount } from "../food/contract.js";
import type { FoodDay, FoodEntry, SearchResult } from "../food/contract.js";
import type { FoodItem } from "../food/food.js";
import { getFoodDay, logFoods, mutateFood } from "../food/food.js";
import { mutateRecord } from "../journal/records.js";
import { fillDailyMeals } from "../meals/meals.js";
import type { TargetsForDay } from "../targets/contract.js";
import { targetsKind } from "../targets/targets.js";
import { instantAt, localDate, timeZoneSchema } from "../time.js";
import { activities, strengthExerciseSchema, workoutInputSchema } from "../workouts/contract.js";
import type { Workout, WorkoutDay } from "../workouts/contract.js";
import { getWorkoutDay, workoutRecords } from "../workouts/workouts.js";

const instructions = `Nouri is the person's food and training journal. Log what they ate with log_meal and what they trained with log_workout.
Prefer a catalog food from search_foods when one matches; otherwise estimate the nutrients yourself and use null for any you cannot estimate.
Dates and times are the person's own wall clock. Leave them out for "now". Check your work with get_day, and remove a wrong entry with delete_entry.`;

// Wall-clock fields shared by both log tools. The assistant never works out UTC offsets.
const when = {
  date: z.iso.date().optional().describe("Local date, YYYY-MM-DD. Defaults to today."),
  time: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/).optional().describe("Local time, HH:MM in 24 hours. Defaults to now, or noon when only a date is given."),
  timeZone: timeZoneSchema.optional().describe("IANA zone such as Europe/Lisbon. Defaults to the zone of the person's latest entry; needed only for their first entry or while travelling."),
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

type ToolOutput =
  | SearchResult
  | Workout
  | { date: string; timeZone: string; entries: FoodEntry[] }
  | { date: string; food: FoodDay["food"]; workouts: WorkoutDay; targets: TargetsForDay }
  | { deleted: { kind: "food" | "workout"; id: string } };

// Results go back as JSON text, which every MCP client shows to its model.
const text = (value: ToolOutput): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

const failure = (message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: message }] });

// The zone of the person's latest manual food or workout. Imported workouts may carry a bare UTC offset, so they are skipped.
async function latestZone(db: AppDatabase, userId: string): Promise<string | null> {
  const [[food], [workout]] = await Promise.all([
    db.select({ timeZone: foodEntries.timeZone, createdAt: foodEntries.createdAt }).from(foodEntries)
      .where(and(eq(foodEntries.userId, userId), isNull(foodEntries.deletedAt))).orderBy(desc(foodEntries.createdAt)).limit(1),
    db.select({ timeZone: workouts.timeZone, createdAt: workouts.createdAt }).from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.source, "manual"), isNull(workouts.deletedAt))).orderBy(desc(workouts.createdAt)).limit(1),
  ]);

  const latest = food && workout ? (food.createdAt > workout.createdAt ? food : workout) : food ?? workout;

  return latest?.timeZone ?? null;
}

async function resolveWhen(db: AppDatabase, userId: string, input: { date?: string | undefined; time?: string | undefined; timeZone?: string | undefined }): Promise<{ occurredAt: string; timeZone: string } | null> {
  const timeZone = input.timeZone ?? await latestZone(db, userId);

  if (!timeZone) return null;
  const now = new Date().toISOString();

  if (input.date === undefined && input.time === undefined) return { occurredAt: now, timeZone };

  return { occurredAt: instantAt(input.date ?? localDate(now, timeZone), input.time ?? "12:00", timeZone), timeZone };
}

const noZone = failure("The person has no entries to take a time zone from. Ask for their time zone and pass timeZone.");

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
    const input = workoutInputSchema.safeParse({ ...at, activity, durationMinutes, distanceM: distanceM ?? null, energyKcal: energyKcal ?? null, strengthExercises: exercises ?? null });

    if (!input.success) return failure(input.error.issues.map((issue) => issue.message).join(" "));
    const result = await mutateRecord(db, userId, randomUUID(), workoutRecords, { kind: "create", input: input.data });

    return result.outcome === "created" ? text(result.entry) : failure("The workout was not logged.");
  });

  server.registerTool("get_day", {
    title: "Get a day",
    description: "The foods, nutrient totals, workouts, and targets for a local day. A null total means nothing or something without that value was logged, not zero.",
    inputSchema: { date: when.date },
    annotations: { readOnlyHint: true },
  }, async ({ date }) => {
    const day = date ?? localDate(new Date().toISOString(), await latestZone(db, userId) ?? "UTC");

    // MCP sits outside /v1, so it brings daily meals up to date itself.
    await fillDailyMeals(db, userId);
    const [{ food }, workoutDay, targets] = await Promise.all([getFoodDay(db, userId, day), getWorkoutDay(db, userId, day), getDated(db, targetsKind, userId, day)]);

    return text({ date: day, food, workouts: workoutDay, targets });
  });

  server.registerTool("delete_entry", {
    title: "Delete an entry",
    description: "Remove a food or workout entry by the id log_meal, log_workout, or get_day returned. Workouts imported from a wearable cannot be removed here.",
    inputSchema: { kind: z.enum(["food", "workout"]), id: z.uuid() },
    annotations: { destructiveHint: true, idempotentHint: true },
  }, async ({ kind, id }) => {
    const table = kind === "food" ? foodEntries : workouts;
    const [row] = await db.select({ revision: table.revision }).from(table).where(and(eq(table.userId, userId), eq(table.id, id), isNull(table.deletedAt)));

    if (!row) return failure(`No ${kind} entry with that id.`);
    const command = { kind: "delete" as const, id, revision: row.revision };
    const result = kind === "food" ? await mutateFood(db, userId, randomUUID(), command) : await mutateRecord(db, userId, randomUUID(), workoutRecords, command);

    switch (result.outcome) {
      case "deleted":
        return text({ deleted: { kind, id } });
      case "stale":
        return failure("The entry changed while deleting it. Try again.");
      default:
        return failure(kind === "workout" ? "That workout was imported from a wearable and cannot be removed here." : `No ${kind} entry with that id.`);
    }
  });

  return server;
}
