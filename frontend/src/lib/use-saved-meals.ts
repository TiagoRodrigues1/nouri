import { queryOptions, useQuery } from "@tanstack/react-query";
import { createSavedMeal, deleteSavedMeal, getSavedMeals, logSavedMeal, type SavedMeal } from "./api";
import { useIdempotentDelete, useIdempotentWrite } from "./use-idempotent";
import type { MealInput, MealLogInput } from "../../../src/meals/contract";

type PendingLog = { meal: SavedMeal; input: MealLogInput };

function savedMealsQueryOptions(token: string) {
  return queryOptions({ queryKey: ["saved-meals", token], queryFn: () => getSavedMeals(token), enabled: Boolean(token) });
}

export function useSavedMeals(token: string) {
  return useQuery(savedMealsQueryOptions(token));
}

export function useSaveMeal(token: string, onSaved: () => void) {
  return useIdempotentWrite<MealInput>(token, (input, key) => createSavedMeal(token, key, input), {
    refresh: ["saved-meals"], success: (input) => `${input.name} saved.`, onSuccess: onSaved,
  });
}

// A meal logs as one request, so a retry after a dropped response never adds its foods twice.
export function useLogMeal(token: string, onLogged: () => void) {
  return useIdempotentWrite<PendingLog>(token, (pending, key) => logSavedMeal(token, key, pending.meal, pending.input), {
    refresh: ["day", "overview"], success: (pending) => `${pending.meal.name} added to your log.`, onSuccess: onLogged,
    signature: (pending) => JSON.stringify([pending.meal.id, pending.input]),
  });
}

export function useDeleteMeal(token: string) {
  return useIdempotentDelete<SavedMeal>(token, (meal, key) => deleteSavedMeal(token, meal, key), {
    refresh: ["saved-meals"], success: (meal) => `${meal.name} removed from your saved meals.`,
  });
}
