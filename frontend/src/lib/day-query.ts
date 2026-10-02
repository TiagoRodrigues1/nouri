import { queryOptions } from "@tanstack/react-query";
import { getDay, getOverview, getWorkoutSummary } from "./api";

// One definition, so every screen reading a day shares the cache and the refreshes after a change.
export function dayQueryOptions(date: string) {
  return queryOptions({ queryKey: ["day", date], queryFn: () => getDay(date) });
}

export function overviewQueryOptions(date: string) {
  return queryOptions({ queryKey: ["overview", date], queryFn: () => getOverview(date) });
}

export function workoutSummaryQueryOptions(date: string) {
  return queryOptions({ queryKey: ["workout-summary", date], queryFn: () => getWorkoutSummary(date) });
}
