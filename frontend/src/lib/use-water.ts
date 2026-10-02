import { createRecord, deleteRecord } from "./api";
import { recordPaths } from "../../../src/journal/paths";
import type { WaterEntry, WaterInput } from "../../../src/water/contract";
import { useIdempotentWrite, useIdempotentDelete } from "./use-idempotent";
import { queryRefresh } from "./query-refresh";

// `onSaved` runs as soon as the server accepts the drink, before the day is read again.
type PendingWater = { input: WaterInput; signature: string; onSaved: () => void };

export function useWater() {
  const refresh = queryRefresh.water;

  const create = useIdempotentWrite<PendingWater>((pending, key) => createRecord(key, { path: recordPaths.water, input: pending.input }), {
    refresh, success: () => "Water added to your log.", signature: (pending) => pending.signature, onSuccess: (pending) => pending.onSaved(),
  });

  const remove = useIdempotentDelete<WaterEntry>((entry, key) => deleteRecord(recordPaths.water, entry, key), { refresh, success: () => "Water removed from your log." });

  return {
    pending: create.isPending || remove.isPending,
    add: (input: WaterInput, onSuccess: () => void) => {
      create.mutate({ input, signature: JSON.stringify(input), onSaved: onSuccess });
    },
    remove: (entry: WaterEntry) => remove.mutate(entry),
  };
}
