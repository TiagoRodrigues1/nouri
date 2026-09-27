import { z } from "zod";
import { recordPaths } from "../../../src/journal/paths";
import type { FoodSubmission, RepeatInput } from "../../../src/food/contract";
import type { WaterInput } from "../../../src/water/contract";
import type { MeasurementInput } from "../../../src/measurements/contract";
import type { SleepInput } from "../../../src/sleep/contract";
import type { IntakeInput } from "../../../src/supplements/contract";
import { workoutSummarySchema, type WorkoutInput, type WorkoutSummary } from "../../../src/workouts/contract";
import { dashboardSchema } from "../../../src/dashboard/contract";
import type { Dashboard } from "../../../src/dashboard/contract";
import { daySchema } from "../../../src/days/contract";
import type { Day } from "../../../src/days/contract";
import { entrySchema, searchResultSchema } from "../../../src/food/contract";
import type { FoodEntry, SearchResult } from "../../../src/food/contract";
import { overviewSchema } from "../../../src/overview/contract";
import { authorizationSchema, callbackResults, connectionStatusSchema, disconnectResultSchema, syncResultSchema } from "../../../src/wearables/contract";
import type { ConnectionStatus, DisconnectResult, SyncResult, WearableProvider } from "../../../src/wearables/contract";
import type { Overview } from "../../../src/overview/contract";

export { callbackResults };

export type { CardId, Dashboard } from "../../../src/dashboard/contract";

export type { Day } from "../../../src/days/contract";

export type { FoodEntry, SearchResult } from "../../../src/food/contract";

export type { WaterEntry } from "../../../src/water/contract";

export type { Measurement, MeasurementKind } from "../../../src/measurements/contract";

export type { Overview } from "../../../src/overview/contract";

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

export async function getDay(token: string, date: string): Promise<Day> {
  return request(token, `/v1/days/${date}`, daySchema);
}

export async function searchFoods(token: string, query: string): Promise<SearchResult> {
  return request(token, `/v1/foods/search?q=${encodeURIComponent(query)}&locale=en`, searchResultSchema);
}

export async function createFood(token: string, key: string, input: FoodSubmission): Promise<FoodEntry> {
  return request(token, "/v1/food-entries", entrySchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(input),
  });
}

export async function repeatFood(token: string, key: string, entry: FoodEntry, input: RepeatInput): Promise<FoodEntry> {
  return request(token, `/v1/food-entries/${encodeURIComponent(entry.id)}/repeats`, entrySchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(input),
  });
}

export async function updateFood(token: string, key: string, entry: FoodEntry, input: FoodSubmission): Promise<FoodEntry> {
  return request(token, `/v1/food-entries/${encodeURIComponent(entry.id)}`, entrySchema, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, "If-Match": `"${entry.revision}"` },
    body: JSON.stringify(input),
  });
}

export async function deleteFood(token: string, entry: FoodEntry, key: string): Promise<void> {
  await request(token, `/v1/food-entries/${encodeURIComponent(entry.id)}`, z.null(), {
    method: "DELETE",
    headers: { "Idempotency-Key": key, "If-Match": `"${entry.revision}"` },
  });
}

export async function getOverview(token: string, date: string): Promise<Overview> {
  return request(token, `/v1/overview/${date}`, overviewSchema);
}

export async function getWorkoutSummary(token: string, date: string): Promise<WorkoutSummary> {
  return request(token, `${recordPaths.workout}/summary/${date}`, workoutSummarySchema);
}

export async function createRecord(token: string, key: string, command: RecordCommand): Promise<void> {
  await request(token, command.path, recordSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(command.input),
  });
}

export async function createPhoto(token: string, key: string, form: FormData): Promise<void> {
  await request(token, recordPaths.photo, recordSchema, {
    method: "POST",
    headers: { "Idempotency-Key": key },
    body: form,
  });
}

export async function deleteRecord(token: string, path: RecordPath, entry: { id: string; revision: number }, key: string): Promise<void> {
  await request(token, `${path}/${encodeURIComponent(entry.id)}`, z.null(), {
    method: "DELETE",
    headers: { "Idempotency-Key": key, "If-Match": `"${entry.revision}"` },
  });
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
