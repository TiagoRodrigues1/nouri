import { queryOptions } from "@tanstack/react-query";
import { getDay, getOverview } from "./api";

// One definition, so every screen reading a day shares the cache and the refreshes after a change.
export function dayQueryOptions(token: string, date: string) {
  return queryOptions({ queryKey: ["day", token, date], queryFn: () => getDay(token, date), enabled: Boolean(token) });
}

export function overviewQueryOptions(token: string, date: string) {
  return queryOptions({ queryKey: ["overview", token, date], queryFn: () => getOverview(token, date), enabled: Boolean(token) });
}
