import { currentTime, localDate, occurredAt, repeatFood, timeZone, type FoodEntry } from "./api";
import { useIdempotentCreate } from "./use-idempotent";
import type { RepeatInput } from "../../../src/food/contract";

type PendingRepeat = { entry: FoodEntry; date: string; input: RepeatInput };

// Logs the same food and amount again today at the current time, whichever day is on screen.
export function useLogAgain(token: string, shownDate: string) {
  const mutation = useIdempotentCreate<PendingRepeat>(token, (pending, key) => repeatFood(token, key, pending.entry, pending.input), {
    refresh: ["day", "overview"],
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
