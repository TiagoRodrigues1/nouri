import { z } from "zod";
import { recordPaths } from "../../../src/journal/paths";
import type { FoodSubmission, RepeatInput } from "../../../src/food/contract";
import type { WaterInput } from "../../../src/water/contract";
import type { MeasurementInput } from "../../../src/measurements/contract";
import type { SleepInput } from "../../../src/sleep/contract";
import type { IntakeInput } from "../../../src/supplements/contract";
import type { WorkoutInput } from "../../../src/workouts/contract";
import { workoutSummarySchema } from "../../../src/workouts/contract";
import type { WorkoutSummary } from "../../../src/workouts/contract";
import { dashboardSchema } from "../../../src/dashboard/contract";
import type { Dashboard } from "../../../src/dashboard/contract";
import { daySchema } from "../../../src/days/contract";
import type { Day } from "../../../src/days/contract";
import { entrySchema, searchResultSchema } from "../../../src/food/contract";
import type { FoodEntry, SearchResult } from "../../../src/food/contract";
import { overviewSchema } from "../../../src/overview/contract";
import { reviewSchema } from "../../../src/review/contract";
import type { Review } from "../../../src/review/contract";
import { mealLogSchema, savedMealListSchema, savedMealSchema } from "../../../src/meals/contract";
import type { MealEdit, MealInput, MealLogInput, SavedMeal } from "../../../src/meals/contract";
import { authorizationSchema, callbackResults, connectionStatusSchema, disconnectResultSchema, syncResultSchema } from "../../../src/wearables/contract";
import type { ConnectionStatus, DisconnectResult, SyncResult, WearableProvider } from "../../../src/wearables/contract";
import type { Overview } from "../../../src/overview/contract";

export { callbackResults };

export type { CardId, Dashboard } from "../../../src/dashboard/contract";

export type { Day } from "../../../src/days/contract";

export type { FoodEntry, SearchResult } from "../../../src/food/contract";

export type { SavedMeal } from "../../../src/meals/contract";

export type { WaterEntry } from "../../../src/water/contract";

export type { Measurement, MeasurementKind } from "../../../src/measurements/contract";

export type { Overview } from "../../../src/overview/contract";

export type { Review, ReviewDay } from "../../../src/review/contract";

export type { Photo } from "../../../src/photos/contract";

export type { SleepSession } from "../../../src/sleep/contract";

export type { Supplement, SupplementDay, SupplementIntake, SupplementKind } from "../../../src/supplements/contract";

export type { Targets } from "../../../src/targets/contract";

export type { CallbackResult, ConnectionStatus, ImportKind, WearableProvider } from "../../../src/wearables/contract";

export type { Activity, Workout } from "../../../src/workouts/contract";

export type RecordPath = (typeof recordPaths)[keyof typeof recordPaths];

export type RecordCommand =
  | { path: typeof recordPaths.water; input: WaterInput }
  | { path: typeof recordPaths.measurement; input: MeasurementInput }
  | { path: typeof recordPaths.workout; input: WorkoutInput }
  | { path: typeof recordPaths.sleep; input: SleepInput }
  | { path: typeof recordPaths.supplementIntake; input: IntakeInput };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

const recordSchema = z.object({ id: z.uuid(), revision: z.number().int() });

export type Candidate = SearchResult["items"][number];

export async function request<Schema extends z.ZodType>(
  token: string,
  path: string,
  schema: Schema,
  init: RequestInit = {},
): Promise<z.output<Schema>> {
  const response = await fetch(path, {
    ...init,
    headers: new Headers({
      ...Object.fromEntries(new Headers(init.headers)),
      Authorization: `Bearer ${token}`,
    }),
  });

  if (response.status === 204) {
    return schema.parse(null);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = z.object({ error: z.string() }).safeParse(body);

    const message = parsed.success
      ? parsed.data.error
      : `Request failed (${response.status}).`;

    throw new ApiError(
      response.status === 401
        ? "API token rejected. Check it and connect again."
        : message,
      response.status,
    );
  }

  return schema.parse(body);
}

// A write sends its own Idempotency-Key, and the revision it replaces when it edits or deletes a record.
type Write = { method: "POST" | "PATCH" | "DELETE"; key: string; revision?: number; json?: unknown; form?: FormData };

async function write<Schema extends z.ZodType>(token: string, path: string, schema: Schema, { method, key, revision, json, form }: Write): Promise<z.output<Schema>> {
  const headers = new Headers({ "Idempotency-Key": key });

  if (revision !== undefined) headers.set("If-Match", `"${revision}"`);

  if (json !== undefined) headers.set("Content-Type", "application/json");

  return request(token, path, schema, { method, headers, body: form ?? (json === undefined ? null : JSON.stringify(json)) });
}

export async function getDay(token: string, date: string): Promise<Day> {
  return request(token, `/v1/days/${date}`, daySchema);
}

export async function searchFoods(token: string, query: string): Promise<SearchResult> {
  return request(token, `/v1/foods/search?q=${encodeURIComponent(query)}&locale=en`, searchResultSchema);
}

export async function createFood(token: string, key: string, input: FoodSubmission): Promise<FoodEntry> {
  return write(token, "/v1/food-entries", entrySchema, { method: "POST", key, json: input });
}

export async function repeatFood(token: string, key: string, entry: FoodEntry, input: RepeatInput): Promise<FoodEntry> {
  return write(token, `/v1/food-entries/${encodeURIComponent(entry.id)}/repeats`, entrySchema, { method: "POST", key, json: input });
}

export async function updateFood(token: string, key: string, entry: FoodEntry, input: FoodSubmission): Promise<FoodEntry> {
  return write(token, `/v1/food-entries/${encodeURIComponent(entry.id)}`, entrySchema, { method: "PATCH", key, revision: entry.revision, json: input });
}

export async function deleteFood(token: string, entry: FoodEntry, key: string): Promise<void> {
  await write(token, `/v1/food-entries/${encodeURIComponent(entry.id)}`, z.null(), { method: "DELETE", key, revision: entry.revision });
}

export async function getSavedMeals(token: string): Promise<SavedMeal[]> {
  return (await request(token, "/v1/saved-meals", savedMealListSchema)).meals;
}

export async function createSavedMeal(token: string, key: string, input: MealInput): Promise<SavedMeal> {
  return write(token, "/v1/saved-meals", savedMealSchema, { method: "POST", key, json: input });
}

export async function updateSavedMeal(token: string, key: string, meal: SavedMeal, input: MealEdit): Promise<SavedMeal> {
  return write(token, `/v1/saved-meals/${encodeURIComponent(meal.id)}`, savedMealSchema, { method: "PATCH", key, revision: meal.revision, json: input });
}

export async function logSavedMeal(token: string, key: string, meal: SavedMeal, input: MealLogInput): Promise<FoodEntry[]> {
  const { entries } = await write(token, `/v1/saved-meals/${encodeURIComponent(meal.id)}/logs`, mealLogSchema, { method: "POST", key, json: input });

  return entries;
}

export async function deleteSavedMeal(token: string, meal: SavedMeal, key: string): Promise<void> {
  await write(token, `/v1/saved-meals/${encodeURIComponent(meal.id)}`, z.null(), { method: "DELETE", key, revision: meal.revision });
}

export async function getReview(token: string, date: string): Promise<Review> {
  return request(token, `/v1/review/${date}`, reviewSchema);
}

export async function getOverview(token: string, date: string): Promise<Overview> {
  return request(token, `/v1/overview/${date}`, overviewSchema);
}

export async function getWorkoutSummary(token: string, date: string): Promise<WorkoutSummary> {
  return request(token, `${recordPaths.workout}/summary/${date}`, workoutSummarySchema);
}

export async function createRecord(token: string, key: string, command: RecordCommand): Promise<void> {
  await write(token, command.path, recordSchema, { method: "POST", key, json: command.input });
}

export async function createPhoto(token: string, key: string, form: FormData): Promise<void> {
  await write(token, recordPaths.photo, recordSchema, { method: "POST", key, form });
}

export async function deleteRecord(token: string, path: RecordPath, entry: { id: string; revision: number }, key: string): Promise<void> {
  await write(token, `${path}/${encodeURIComponent(entry.id)}`, z.null(), { method: "DELETE", key, revision: entry.revision });
}

// Images need the bearer token, so the page fetches them instead of pointing an <img> at the API.
export async function getPhotoImage(token: string, id: string): Promise<Blob> {
  const response = await fetch(`${recordPaths.photo}/${encodeURIComponent(id)}/image`, { headers: { Authorization: `Bearer ${token}` } });

  if (!response.ok) throw new Error(`Could not load photo (${response.status}).`);

  return response.blob();
}

export async function getConnection(token: string, provider: WearableProvider): Promise<ConnectionStatus> {
  return request(token, `/v1/integrations/${provider}`, connectionStatusSchema);
}

// The server keeps the provider's tokens; the page only learns where to send the browser.
export async function startConnection(token: string, provider: WearableProvider): Promise<string> {
  const { authorizationUrl } = await request(token, `/v1/integrations/${provider}/authorizations`, authorizationSchema, { method: "POST" });

  return authorizationUrl;
}

export async function syncConnection(token: string, provider: WearableProvider): Promise<SyncResult> {
  return request(token, `/v1/integrations/${provider}/syncs`, syncResultSchema, { method: "POST" });
}

export async function disconnectConnection(token: string, provider: WearableProvider): Promise<DisconnectResult> {
  return request(token, `/v1/integrations/${provider}`, disconnectResultSchema, { method: "DELETE" });
}

export async function getDashboard(token: string): Promise<Dashboard> {
  return request(token, "/v1/dashboard", dashboardSchema);
}

export async function saveDashboard(token: string, dashboard: Dashboard): Promise<Dashboard> {
  return request(token, "/v1/dashboard", dashboardSchema, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dashboard),
  });
}

export function format(value: number | null | undefined, digits = 0): string {
  return value == null
    ? "—"
    : new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(
        value,
      );
}
