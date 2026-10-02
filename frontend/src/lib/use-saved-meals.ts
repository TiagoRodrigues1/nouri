import { queryOptions, useQuery } from "@tanstack/react-query";
import { createSavedMeal, deleteSavedMeal, getSavedMeals, logSavedMeal, updateSavedMeal, type SavedMeal } from "./api";
import { useIdempotentDelete, useIdempotentWrite } from "./use-idempotent";
import { queryRefresh } from "./query-refresh";
import type { MealEdit, MealInput, MealLogInput } from "../../../src/meals/contract";

type PendingLog = { meal: SavedMeal; input: MealLogInput };

type PendingEdit = { meal: SavedMeal; input: MealEdit };

function savedMealsQueryOptions() {
  return queryOptions({ queryKey: ["saved-meals"], queryFn: () => getSavedMeals() });
}

export function useSavedMeals() {
  return useQuery(savedMealsQueryOptions());
}

export function useSaveMeal(onSaved: () => void) {
  return useIdempotentWrite<MealInput>((input, key) => createSavedMeal(key, input), {
    refresh: ["saved-meals"], success: (input) => `${input.name} saved.`, onSuccess: onSaved,
  });
}

// The revision is part of the request, so an edit made after another one gets its own key.
export function useEditMeal(onSaved: () => void) {
  return useIdempotentWrite<PendingEdit>((pending, key) => updateSavedMeal(key, pending.meal, pending.input), {
    refresh: ["saved-meals"], success: (pending) => `${pending.input.name} saved.`, onSuccess: onSaved,
    signature: (pending) => JSON.stringify([pending.meal.id, pending.meal.revision, pending.input]),
  });
}

// A meal logs as one request, so a retry after a dropped response never adds its foods twice.
export function useLogMeal(onLogged: () => void) {
  return useIdempotentWrite<PendingLog>((pending, key) => logSavedMeal(key, pending.meal, pending.input), {
    refresh: queryRefresh.food, success: (pending) => `${pending.meal.name} added to your log.`, onSuccess: onLogged,
    signature: (pending) => JSON.stringify([pending.meal.id, pending.input]),
  });
}

export function useDeleteMeal() {
  return useIdempotentDelete<SavedMeal>((meal, key) => deleteSavedMeal(meal, key), {
    refresh: ["saved-meals"], success: (meal) => `${meal.name} removed from your saved meals.`,
  });
}
