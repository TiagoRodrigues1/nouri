import { createWater, deleteWater, occurredAt, timeZone } from "./api";
import type { WaterEntry, WaterInput } from "../../../src/water/contract";
import { useIdempotentCreate, useIdempotentDelete } from "./use-idempotent";

export function useWater(token: string, date: string, onConnect: () => void) {
  const refresh = ["day", "overview"];

  const create = useIdempotentCreate<WaterInput>(token, (input, key) => createWater(token, key, input), {
    refresh, signature: (input) => JSON.stringify({ date, volumeMl: input.volumeMl }),
  });

  const remove = useIdempotentDelete<WaterEntry>(token, (entry, key) => deleteWater(token, entry, key), { refresh, success: () => "Water removed from your log." });

  return {
    pending: create.isPending || remove.isPending,
    add: (volumeMl: number) => {
      if (!token) {
        onConnect();
 
        return;
      }

      create.mutate({ occurredAt: occurredAt(date), timeZone, volumeMl });
    },
    remove: (entry: WaterEntry) => remove.mutate(entry),
  };
}
