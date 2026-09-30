import { createRecord, deleteRecord } from "./api";
import { recordPaths } from "../../../src/journal/paths";
import type { WaterEntry, WaterInput } from "../../../src/water/contract";
import { useIdempotentWrite, useIdempotentDelete } from "./use-idempotent";

type PendingWater = { input: WaterInput; signature: string };

export function useWater(token: string, onConnect: () => void) {
  const refresh = ["day", "overview"];

  const create = useIdempotentWrite<PendingWater>(token, (pending, key) => createRecord(token, key, { path: recordPaths.water, input: pending.input }), {
    refresh, success: () => "Water added to your log.", signature: (pending) => pending.signature,
  });

  const remove = useIdempotentDelete<WaterEntry>(token, (entry, key) => deleteRecord(token, recordPaths.water, entry, key), { refresh, success: () => "Water removed from your log." });

  return {
    pending: create.isPending || remove.isPending,
    add: (input: WaterInput, onSuccess: () => void) => {
      if (!token) {
        onConnect();

        return;
      }

      create.mutate({ input, signature: JSON.stringify(input) }, { onSuccess });
    },
    remove: (entry: WaterEntry) => remove.mutate(entry),
  };
}
