import { queryOptions } from "@tanstack/react-query";
import { getDay } from "./api";

// One definition, so every screen reading a day shares the cache and the refreshes after a change.
export function dayQueryOptions(token: string, date: string) {
  return queryOptions({ queryKey: ["day", token, date], queryFn: () => getDay(token, date), enabled: Boolean(token) });
}
