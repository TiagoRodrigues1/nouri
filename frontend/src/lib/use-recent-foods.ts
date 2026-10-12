import { useQuery } from "@tanstack/react-query";
import { getRecentFoods, logFoodBatch } from "./api";
import { useIdempotentWrite } from "./use-idempotent";
import { queryRefresh } from "./query-refresh";
import type { FoodBatchInput } from "../../../src/food/contract";

export function useRecentFoods() {
  return useQuery({ queryKey: ["recent-foods"], queryFn: getRecentFoods });
}

// The foods ticked in the log dialog log as one request, so a retry after a dropped response never adds them twice.
export function useLogFoods(onLogged: () => void) {
  return useIdempotentWrite<FoodBatchInput>((input, key) => logFoodBatch(key, input), {
    refresh: queryRefresh.food, onSuccess: onLogged,
    success: (input) => `${input.items.length} ${input.items.length === 1 ? "food" : "foods"} added to your log.`,
  });
}
