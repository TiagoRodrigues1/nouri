import { createRecord, deleteRecord } from "./api";
import { occurredAt, timeZone } from "./time";
import { recordPaths } from "../../../src/journal/paths";
import type { WaterEntry, WaterInput } from "../../../src/water/contract";
import { useIdempotentWrite, useIdempotentDelete } from "./use-idempotent";

type PendingWater = { input: WaterInput; signature: string };

export function useWater(token: string, date: string, onConnect: () => void) {
  const refresh = ["day", "overview"];

  const create = useIdempotentWrite<PendingWater>(token, (pending, key) => createRecord(token, key, { path: recordPaths.water, input: pending.input }), {
    refresh, signature: (pending) => pending.signature,
  });

  const remove = useIdempotentDelete<WaterEntry>(token, (entry, key) => deleteRecord(token, recordPaths.water, entry, key), { refresh, success: () => "Water removed from your log." });

  return {
    pending: create.isPending || remove.isPending,
    add: (volumeMl: number) => {
      if (!token) {
        onConnect();
 
        return;
      }

      create.mutate({
        input: { occurredAt: occurredAt(date), timeZone, volumeMl },
        signature: JSON.stringify({ date, volumeMl }),
      });
    },
    remove: (entry: WaterEntry) => remove.mutate(entry),
  };
}
