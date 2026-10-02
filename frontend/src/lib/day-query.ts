import { queryOptions } from "@tanstack/react-query";
import { getDay, getOverview, getWorkoutSummary } from "./api";

// One definition, so every screen reading a day shares the cache and the refreshes after a change.
export function dayQueryOptions(token: string, date: string) {
  return queryOptions({ queryKey: ["day", token, date], queryFn: () => getDay(token, date), enabled: Boolean(token) });
}

export function overviewQueryOptions(token: string, date: string) {
  return queryOptions({ queryKey: ["overview", token, date], queryFn: () => getOverview(token, date), enabled: Boolean(token) });
}

export function workoutSummaryQueryOptions(token: string, date: string) {
  return queryOptions({ queryKey: ["workout-summary", token, date], queryFn: () => getWorkoutSummary(token, date), enabled: Boolean(token) });
}
