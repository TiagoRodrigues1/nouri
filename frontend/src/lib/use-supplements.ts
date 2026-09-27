import { createRecord, deleteRecord, type Supplement, type SupplementIntake } from "./api";
import { currentTime, occurredAt, timeZone } from "./time";
import { recordPaths } from "../../../src/journal/paths";
import { stackForDaySchema } from "../../../src/supplements/contract";
import { datedResource } from "./dated-resource";
import { useIdempotentWrite, useIdempotentDelete } from "./use-idempotent";

type PendingIntake = { supplement: Supplement; date: string; time: string };

// The day's checklist is built from the stack and the intakes, so either change refreshes both screens.
const refresh = ["day", "overview"];

// Ticks supplements off on the day on screen. The server fills in name and dose from that day's stack.
export function useSupplements(token: string, date: string) {
  const create = useIdempotentWrite<PendingIntake>(token, (pending, key) => createRecord(token, key, {
    path: recordPaths.supplementIntake,
    input: { occurredAt: occurredAt(pending.date, pending.time), timeZone, supplementId: pending.supplement.id },
  }), {
    refresh, success: (pending) => `${pending.supplement.name} taken.`,
    signature: (pending) => JSON.stringify([pending.date, pending.time, pending.supplement.id]),
  });

  const remove = useIdempotentDelete<SupplementIntake>(token, (intake, key) => deleteRecord(token, recordPaths.supplementIntake, intake, key), {
    refresh, success: (intake) => `${intake.name} unmarked.`,
  });

  return {
    pending: create.isPending || remove.isPending,
    take: (supplement: Supplement) => {
      create.mutate({ supplement, date, time: currentTime() });
    },
    remove: (intake: SupplementIntake) => remove.mutate(intake),
  };
}

const stackResource = datedResource<Supplement[], typeof stackForDaySchema>(recordPaths.supplementStack, "supplement-stack", stackForDaySchema, {
  refresh,
  body: (supplements) => ({ supplements }),
});

export const useSupplementStack = stackResource.useDatedQuery;

export const useSaveSupplementStack = stackResource.useSaveDated;
