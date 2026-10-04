import { useQuery } from "@tanstack/react-query";
import { getRecentFoods, repeatFood } from "./api";
import { useIdempotentWrite } from "./use-idempotent";
import { queryRefresh } from "./query-refresh";
import type { RecentFood, RepeatInput } from "../../../src/food/contract";

type PendingLog = { recent: RecentFood; input: RepeatInput };

export function useRecentFoods() {
  return useQuery({ queryKey: ["recent-foods"], queryFn: getRecentFoods });
}

// Logs a recent food from its latest entry, so the server copies the recorded food and scales it to the amount.
export function useLogRecent(onLogged: () => void) {
  return useIdempotentWrite<PendingLog>((pending, key) => repeatFood(key, pending.recent.entryId, pending.input), {
    refresh: queryRefresh.food, success: (pending) => `${pending.recent.food.name} added to your log.`, onSuccess: onLogged,
    signature: (pending) => JSON.stringify([pending.recent.entryId, pending.input]),
  });
}
