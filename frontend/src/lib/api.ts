import { getToken } from "@clerk/react";
import { z } from "zod";
import { recordPaths } from "../../../src/journal/paths";
import type { FoodBatchInput, FoodSubmission, RepeatInput } from "../../../src/food/contract";
import type { WaterInput } from "../../../src/water/contract";
import type { MeasurementInput } from "../../../src/measurements/contract";
import type { SleepInput } from "../../../src/sleep/contract";
import type { IntakeInput } from "../../../src/supplements/contract";
import type { WorkoutInput } from "../../../src/workouts/contract";
import { exerciseHistoryListSchema, workoutSummarySchema } from "../../../src/workouts/contract";
import type { ExerciseHistoryList, WorkoutSummary } from "../../../src/workouts/contract";
import { customExerciseSchema, exerciseLibrarySchema } from "../../../src/exercises/contract";
import type { CustomExercise, CustomExerciseInput, ExerciseLibrary } from "../../../src/exercises/contract";
import { routineListSchema, routineSchema } from "../../../src/routines/contract";
import type { Routine, RoutineInput } from "../../../src/routines/contract";
import { dashboardSchema } from "../../../src/dashboard/contract";
import type { Dashboard } from "../../../src/dashboard/contract";
import { daySchema } from "../../../src/days/contract";
import type { Day } from "../../../src/days/contract";
import { barcodeLookupSchema, entrySchema, foodBatchSchema, labelFoodSchema, recentFoodsSchema, searchResultSchema } from "../../../src/food/contract";
import type { BarcodeLookup, CommunityFoodInput, FoodEntry, LabelFood, RecentFood, SearchResult } from "../../../src/food/contract";
import { overviewSchema } from "../../../src/overview/contract";
import { reviewSchema } from "../../../src/review/contract";
import type { Review, ReviewRange } from "../../../src/review/contract";
import { mealLogSchema, savedMealListSchema, savedMealSchema } from "../../../src/meals/contract";
import type { ListedMeal, MealInput, MealLogInput, SavedMeal } from "../../../src/meals/contract";
import { authorizationSchema, callbackResults, connectionStatusSchema, importKindNames, importKinds, disconnectResultSchema, syncResultSchema } from "../../../src/wearables/contract";
import type { ConnectionStatus, DisconnectResult, SyncResult, WearableProvider } from "../../../src/wearables/contract";
import type { Overview } from "../../../src/overview/contract";
import { assistantListSchema } from "../../../src/assistants/contract";
import type { Assistant } from "../../../src/assistants/contract";

export { callbackResults, importKindNames, importKinds };

export type { CardId, Dashboard } from "../../../src/dashboard/contract";

export type { Assistant } from "../../../src/assistants/contract";

export type { Day } from "../../../src/days/contract";

export type { BarcodeLookup, FoodEntry, LabelFood, PackagedProduct, RecentFood, SearchResult } from "../../../src/food/contract";

export type { ListedMeal, SavedMeal } from "../../../src/meals/contract";

export type { WaterEntry } from "../../../src/water/contract";

export type { Measurement, MeasurementKind } from "../../../src/measurements/contract";

export type { Overview } from "../../../src/overview/contract";

export type { Review, ReviewDay, ReviewPeriod } from "../../../src/review/contract";

export type { Photo } from "../../../src/photos/contract";

export type { SleepSession } from "../../../src/sleep/contract";

export type { Supplement, SupplementDay, SupplementIntake, SupplementKind } from "../../../src/supplements/contract";

export type { Profile, ProfileView, SuggestedTargets, Suggestion } from "../../../src/profile/contract";

export type { Targets } from "../../../src/targets/contract";

export type { CallbackResult, ConnectionStatus, ImportKind, WearableProvider } from "../../../src/wearables/contract";

export type { Activity, ExerciseHistory, ExerciseSession, Workout } from "../../../src/workouts/contract";

export type { CustomExercise, Equipment, ExerciseLibrary, LibraryExercise, Muscle, MuscleMap } from "../../../src/exercises/contract";

export type { RepTarget, Routine } from "../../../src/routines/contract";

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

// Clerk refreshes the short-lived session token as needed, so every request asks for the current one.
async function authorized(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = await getToken();

  if (token) headers.set("Authorization", `Bearer ${token}`);

  return fetch(path, { ...init, headers });
}

export async function request<Schema extends z.ZodType>(
  path: string,
  schema: Schema,
  init: RequestInit = {},
): Promise<z.output<Schema>> {
  const response = await authorized(path, init);

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
        ? "Your session has ended. Reload the page to sign in again."
        : message,
      response.status,
    );
  }

  return schema.parse(body);
}

// Saves everything Nouri stores for the account as a JSON file, under the name the server gives it.
export async function downloadAccountExport(): Promise<void> {
  const response = await authorized("/v1/account/export");

  if (!response.ok) throw new ApiError(response.status === 401 ? "Your session has ended. Reload the page to sign in again." : "Your data could not be exported. Try again.", response.status);
  const name = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "nouri-export.json";
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");

  link.href = url;
  link.download = name;
  link.click();
  // The download has started reading the blob by the next task, so the URL can go.
  setTimeout(() => URL.revokeObjectURL(url));
}

// A write sends its own Idempotency-Key, and the revision it replaces when it edits or deletes a record.
type Write = { method: "POST" | "PATCH" | "DELETE"; key: string; revision?: number; json?: unknown; form?: FormData };

async function write<Schema extends z.ZodType>(path: string, schema: Schema, { method, key, revision, json, form }: Write): Promise<z.output<Schema>> {
  const headers = new Headers({ "Idempotency-Key": key });

  if (revision !== undefined) headers.set("If-Match", `"${revision}"`);

  if (json !== undefined) headers.set("Content-Type", "application/json");

  return request(path, schema, { method, headers, body: form ?? (json === undefined ? null : JSON.stringify(json)) });
}

export async function getDay(date: string): Promise<Day> {
  return request(`/v1/days/${date}`, daySchema);
}

export async function searchFoods(query: string): Promise<SearchResult> {
  return request(`/v1/foods/search?q=${encodeURIComponent(query)}&locale=en`, searchResultSchema);
}

export async function lookupBarcode(barcode: string): Promise<BarcodeLookup> {
  return request(`/v1/foods/barcodes/${encodeURIComponent(barcode)}`, barcodeLookupSchema);
}

// Adds a typed label to Nouri's foods; others find it once it is reviewed.
export async function createCommunityFood(key: string, input: CommunityFoodInput): Promise<LabelFood> {
  return write("/v1/foods", labelFoodSchema, { method: "POST", key, json: input });
}

export async function getRecentFoods(): Promise<RecentFood[]> {
  return (await request("/v1/foods/recent", recentFoodsSchema)).foods;
}

export async function createFood(key: string, input: FoodSubmission): Promise<FoodEntry> {
  return write("/v1/food-entries", entrySchema, { method: "POST", key, json: input });
}

// Logs several foods at one time in one request, all or none.
export async function logFoodBatch(key: string, input: FoodBatchInput): Promise<FoodEntry[]> {
  const { entries } = await write("/v1/food-entries/batches", foodBatchSchema, { method: "POST", key, json: input });

  return entries;
}

export async function repeatFood(key: string, entryId: string, input: RepeatInput): Promise<FoodEntry> {
  return write(`/v1/food-entries/${encodeURIComponent(entryId)}/repeats`, entrySchema, { method: "POST", key, json: input });
}

export async function updateFood(key: string, entry: FoodEntry, input: FoodSubmission): Promise<FoodEntry> {
  return write(`/v1/food-entries/${encodeURIComponent(entry.id)}`, entrySchema, { method: "PATCH", key, revision: entry.revision, json: input });
}

export async function deleteFood(entry: FoodEntry, key: string): Promise<void> {
  await write(`/v1/food-entries/${encodeURIComponent(entry.id)}`, z.null(), { method: "DELETE", key, revision: entry.revision });
}

export async function getSavedMeals(): Promise<ListedMeal[]> {
  return (await request("/v1/saved-meals", savedMealListSchema)).meals;
}

export async function createSavedMeal(key: string, input: MealInput): Promise<SavedMeal> {
  return write("/v1/saved-meals", savedMealSchema, { method: "POST", key, json: input });
}

export async function updateSavedMeal(key: string, meal: SavedMeal, input: MealInput): Promise<SavedMeal> {
  return write(`/v1/saved-meals/${encodeURIComponent(meal.id)}`, savedMealSchema, { method: "PATCH", key, revision: meal.revision, json: input });
}

export async function logSavedMeal(key: string, meal: SavedMeal, input: MealLogInput): Promise<FoodEntry[]> {
  const { entries } = await write(`/v1/saved-meals/${encodeURIComponent(meal.id)}/logs`, mealLogSchema, { method: "POST", key, json: input });

  return entries;
}

// Removes every food a meal log added. A log never changes, so it takes no revision.
export async function undoMealLog(key: string, id: string): Promise<void> {
  await write(`/v1/meal-logs/${encodeURIComponent(id)}`, z.null(), { method: "DELETE", key });
}

export async function deleteSavedMeal(meal: SavedMeal, key: string): Promise<void> {
  await write(`/v1/saved-meals/${encodeURIComponent(meal.id)}`, z.null(), { method: "DELETE", key, revision: meal.revision });
}

export async function getReview(date: string, days: ReviewRange): Promise<Review> {
  return request(`/v1/review/${date}?days=${days}`, reviewSchema);
}

export async function getOverview(date: string): Promise<Overview> {
  return request(`/v1/overview/${date}`, overviewSchema);
}

export async function getWorkoutSummary(date: string): Promise<WorkoutSummary> {
  return request(`${recordPaths.workout}/summary/${date}`, workoutSummarySchema);
}

export async function getExerciseHistory(): Promise<ExerciseHistoryList> {
  return request(`${recordPaths.workout}/exercises`, exerciseHistoryListSchema);
}

export async function getExerciseLibrary(): Promise<ExerciseLibrary> {
  return request("/v1/exercises", exerciseLibrarySchema);
}

export async function createCustomExercise(key: string, input: CustomExerciseInput): Promise<CustomExercise> {
  return write("/v1/exercises", customExerciseSchema, { method: "POST", key, json: input });
}

export async function deleteCustomExercise(exercise: CustomExercise, key: string): Promise<void> {
  await write(`/v1/exercises/${encodeURIComponent(exercise.id)}`, z.null(), { method: "DELETE", key, revision: exercise.revision });
}

export async function getRoutines(): Promise<Routine[]> {
  return (await request("/v1/routines", routineListSchema)).routines;
}

export async function createRoutine(key: string, input: RoutineInput): Promise<Routine> {
  return write("/v1/routines", routineSchema, { method: "POST", key, json: input });
}

export async function updateRoutine(key: string, routine: Routine, input: RoutineInput): Promise<Routine> {
  return write(`/v1/routines/${encodeURIComponent(routine.id)}`, routineSchema, { method: "PATCH", key, revision: routine.revision, json: input });
}

export async function deleteRoutine(routine: Routine, key: string): Promise<void> {
  await write(`/v1/routines/${encodeURIComponent(routine.id)}`, z.null(), { method: "DELETE", key, revision: routine.revision });
}

export async function createRecord(key: string, command: RecordCommand): Promise<void> {
  await write(command.path, recordSchema, { method: "POST", key, json: command.input });
}

export async function updateRecord(key: string, entry: { id: string; revision: number }, command: RecordCommand): Promise<void> {
  await write(`${command.path}/${encodeURIComponent(entry.id)}`, recordSchema, { method: "PATCH", key, revision: entry.revision, json: command.input });
}

export async function createPhoto(key: string, form: FormData): Promise<void> {
  await write(recordPaths.photo, recordSchema, { method: "POST", key, form });
}

export async function deleteRecord(path: RecordPath, entry: { id: string; revision: number }, key: string): Promise<void> {
  await write(`${path}/${encodeURIComponent(entry.id)}`, z.null(), { method: "DELETE", key, revision: entry.revision });
}

// Images need the session token, so the page fetches them instead of pointing an <img> at the API.
export async function getPhotoImage(id: string, size: "image" | "thumbnail"): Promise<Blob> {
  const response = await authorized(`${recordPaths.photo}/${encodeURIComponent(id)}/${size}`);

  if (!response.ok) throw new Error(`Could not load photo (${response.status}).`);

  return response.blob();
}

export async function getConnection(provider: WearableProvider): Promise<ConnectionStatus> {
  return request(`/v1/integrations/${provider}`, connectionStatusSchema);
}

// The server keeps the provider's tokens; the page only learns where to send the browser.
export async function startConnection(provider: WearableProvider): Promise<string> {
  const { authorizationUrl } = await request(`/v1/integrations/${provider}/authorizations`, authorizationSchema, { method: "POST" });

  return authorizationUrl;
}

export async function syncConnection(provider: WearableProvider): Promise<SyncResult> {
  return request(`/v1/integrations/${provider}/syncs`, syncResultSchema, { method: "POST" });
}

export async function disconnectConnection(provider: WearableProvider): Promise<DisconnectResult> {
  return request(`/v1/integrations/${provider}`, disconnectResultSchema, { method: "DELETE" });
}

export async function getAssistants(): Promise<Assistant[]> {
  return (await request("/v1/assistants", assistantListSchema)).assistants;
}

// Disconnecting is safe to repeat, so it takes no Idempotency-Key.
export async function disconnectAssistant(clientId: string): Promise<void> {
  await request(`/v1/assistants/${encodeURIComponent(clientId)}`, z.null(), { method: "DELETE" });
}

export async function getDashboard(): Promise<Dashboard> {
  return request("/v1/dashboard", dashboardSchema);
}

export async function saveDashboard(dashboard: Dashboard): Promise<Dashboard> {
  return request("/v1/dashboard", dashboardSchema, {
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
