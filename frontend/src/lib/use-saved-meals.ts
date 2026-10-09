import { useQuery } from "@tanstack/react-query";
import { createSavedMeal, deleteSavedMeal, getSavedMeals, logSavedMeal, updateSavedMeal, type SavedMeal } from "./api";
import { useIdempotentDelete, useIdempotentWrite } from "./use-idempotent";
import { queryRefresh } from "./query-refresh";
import type { MealDaily, MealInput, MealLogInput } from "../../../src/meals/contract";

type PendingLog = { meal: SavedMeal; input: MealLogInput };

type PendingSave = { meal: SavedMeal | null; input: MealInput };

// A meal saved as daily may fill today, so the day's reads refresh with the list.
const mealRefresh = ["saved-meals", ...queryRefresh.food];

export function useSavedMeals() {
  return useQuery({ queryKey: ["saved-meals"], queryFn: getSavedMeals });
}

// Creates the meal, or replaces it when one is given. The revision is part of an edit, so an edit made after
// another one gets its own key.
function useMealWrite(success: (pending: PendingSave) => string, onSaved?: () => void) {
  return useIdempotentWrite<PendingSave>(
    ({ meal, input }, key) => (meal ? updateSavedMeal(key, meal, input) : createSavedMeal(key, input)),
    {
      refresh: mealRefresh, success, onSuccess: onSaved,
      signature: ({ meal, input }) => JSON.stringify([meal?.id ?? null, meal?.revision ?? null, input]),
    },
  );
}

export function useSaveMeal(onSaved: () => void) {
  return useMealWrite(({ input }) => `${input.name} saved.`, onSaved);
}

// The one-tap daily toggle: the meal sent back as it is, with only its daily setting changed.
export function useMealDaily() {
  const write = useMealWrite(({ input }) => (input.daily
    ? `${input.name} will be logged every day at ${input.daily.time}.`
    : `${input.name} will no longer be logged every day.`));

  return {
    isPending: write.isPending,
    set: (meal: SavedMeal, daily: MealDaily | null) => write.mutate({
      meal,
      input: { name: meal.name, items: meal.items.map(({ id, food }) => ({ id, amount: food.quantity.amount })), daily },
    }),
  };
}

// A meal logs as one request, so a retry after a dropped response never adds its foods twice.
export function useLogMeal(onLogged: () => void) {
  return useIdempotentWrite<PendingLog>((pending, key) => logSavedMeal(key, pending.meal, pending.input), {
    refresh: queryRefresh.food, success: (pending) => `${pending.meal.name} added to your log.`, onSuccess: onLogged,
    signature: (pending) => JSON.stringify([pending.meal.id, pending.input]),
  });
}

export function useDeleteMeal(onDeleted: () => void) {
  return useIdempotentDelete<SavedMeal>((meal, key) => deleteSavedMeal(meal, key), {
    refresh: ["saved-meals"], success: (meal) => `${meal.name} deleted. Foods already logged from it stay.`, onSuccess: onDeleted,
  });
}
