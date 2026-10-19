import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { createSavedMeal, deleteSavedMeal, getSavedMeals, logSavedMeal, undoMealLog, updateSavedMeal, type FoodEntry, type SavedMeal } from "./api";
import { useIdempotentDelete, useIdempotentWrite } from "./use-idempotent";
import { queryRefresh } from "./query-refresh";
import type { MealDailyInput, MealInput, MealLogInput, MealLogRef } from "../../../src/meals/contract";
import { dailyDays } from "./weekdays";

type PendingLog = { meal: SavedMeal; input: MealLogInput };

type PendingSave = { meal: SavedMeal | null; input: MealInput };

// A meal saved as daily may fill today, and logging a meal or removing a log reorders the list, so the day's
// reads and the list, both among the food reads, refresh together.
const mealRefresh = queryRefresh.food;

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
  const write = useMealWrite(({ meal, input }) => (input.daily
    ? `${input.name} will be logged ${dailyDays(input.daily.weekdays).phrase} at ${input.daily.time}${input.daily.from === "tomorrow" ? " from tomorrow" : ""}.`
    : `${input.name} will no longer be logged ${meal?.daily ? dailyDays(meal.daily.weekdays).phrase : "every day"}.`));

  return {
    isPending: write.isPending,
    set: (meal: SavedMeal, daily: MealDailyInput | null) => write.mutate({
      meal,
      input: { name: meal.name, items: meal.items.map(({ id, food }) => ({ id, amount: food.quantity.amount })), daily },
    }),
  };
}

// A meal logs as one request, so a retry after a dropped response never adds its foods twice. The toast offers to
// undo the whole meal; a log replayed from before meal logs existed has none to undo.
export function useLogMeal(onLogged: () => void) {
  const undo = useUndoMealLog();

  return useIdempotentWrite<PendingLog, FoodEntry[]>((pending, key) => logSavedMeal(key, pending.meal, pending.input), {
    refresh: mealRefresh,
    onSuccess: ({ meal }, entries) => {
      const logId = entries[0]?.mealLogId;

      toast.success(`${meal.name} added to your log.`, logId ? { action: { label: "Undo", onClick: () => undo.mutate({ id: logId, name: meal.name }) } } : undefined);
      onLogged();
    },
    signature: (pending) => JSON.stringify([pending.meal.id, pending.input]),
  });
}

// Removes every food one logging of a meal added.
export function useUndoMealLog() {
  return useIdempotentWrite<MealLogRef>((log, key) => undoMealLog(key, log.id), {
    refresh: mealRefresh, success: (log) => `${log.name} removed from your log.`, signature: (log) => log.id,
  });
}

export function useDeleteMeal(onDeleted: () => void) {
  return useIdempotentDelete<SavedMeal>((meal, key) => deleteSavedMeal(meal, key), {
    refresh: ["saved-meals"], success: (meal) => `${meal.name} deleted. Foods already logged from it stay.`, onSuccess: onDeleted,
  });
}
