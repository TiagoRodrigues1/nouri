import { z } from "zod";
import { daySchema, entrySchema, searchResultSchema } from "../../../src/food/contract";
import type { FoodDay, FoodEntry, SearchResult } from "../../../src/food/contract";

export type { FoodEntry, SearchResult } from "../../../src/food/contract";

export type Day = FoodDay;

export type Candidate = SearchResult["items"][number];

async function request<Schema extends z.ZodType>(
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

    throw new Error(
      response.status === 401
        ? "API token rejected. Check it and connect again."
        : message,
    );
  }

  return schema.parse(body);
}

export async function getDay(token: string, date: string): Promise<FoodDay> {
  return request(token, `/v1/days/${date}`, daySchema);
}

export async function searchFoods(token: string, query: string): Promise<SearchResult> {
  return request(token, `/v1/foods/search?q=${encodeURIComponent(query)}&locale=en`, searchResultSchema);
}

export async function createFood(token: string, key: string, body: string): Promise<FoodEntry> {
  return request(token, "/v1/food-entries", entrySchema, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body,
  });
}

export async function deleteFood(token: string, entry: FoodEntry, key: string): Promise<void> {
  await request(token, `/v1/food-entries/${encodeURIComponent(entry.id)}`, z.null(), {
    method: "DELETE",
    headers: { "Idempotency-Key": key, "If-Match": `"${entry.revision}"` },
  });
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftDate(value: string, days: number): string {
  const [y, m, d] = value.split("-").map(Number);

  return localDate(new Date(y, m - 1, d + days));
}

export function dateLabel(value: string): string {
  const [y, m, d] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

export function format(value: number | null | undefined, digits = 0): string {
  return value == null
    ? "—"
    : new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(
        value,
      );
}

export function occurredAt(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  const now = new Date();

  return new Date(
    y,
    m - 1,
    d,
    now.getHours(),
    now.getMinutes(),
    now.getSeconds(),
  ).toISOString();
}
