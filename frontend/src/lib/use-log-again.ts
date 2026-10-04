import { repeatFood, type FoodEntry } from "./api";
import { currentTime, localDate, occurredAt, timeZone } from "./time";
import { useIdempotentWrite } from "./use-idempotent";
import { queryRefresh } from "./query-refresh";
import type { RepeatInput } from "../../../src/food/contract";

type PendingRepeat = { entry: FoodEntry; date: string; input: RepeatInput };

// Logs the same food and amount again today at the current time, whichever day is on screen.
export function useLogAgain(shownDate: string) {
  const mutation = useIdempotentWrite<PendingRepeat>((pending, key) => repeatFood(key, pending.entry.id, pending.input), {
    refresh: queryRefresh.food,
    success: (pending) => (pending.date === shownDate ? "Food added to your log." : "Food added to today's log."),
    signature: (pending) => JSON.stringify([pending.entry.id, pending.input]),
  });

  function logAgain(entry: FoodEntry) {
    // Read once so the date and time cannot straddle midnight.
    const at = new Date();
    const today = localDate(at);

    mutation.mutate({ entry, date: today, input: { occurredAt: occurredAt(today, currentTime(at)), timeZone } });
  }

  return { logAgain, pending: mutation.isPending };
}
