import { useQuery } from "@tanstack/react-query";
import { createRoutine, deleteRoutine, getRoutines, updateRoutine, type Routine } from "./api";
import { queryRefresh } from "./query-refresh";
import { useIdempotentDelete, useIdempotentWrite } from "./use-idempotent";
import type { RoutineInput } from "../../../src/routines/contract";

type PendingSave = { routine: Routine | null; input: RoutineInput };

export function useRoutines() {
  return useQuery({ queryKey: ["routines"], queryFn: getRoutines });
}

// Creates the routine, or replaces it when one is given. The revision is part of an edit, so an edit made after
// another one gets its own key.
export function useSaveRoutine(onSaved: () => void) {
  return useIdempotentWrite<PendingSave>(
    ({ routine, input }, key) => (routine ? updateRoutine(key, routine, input) : createRoutine(key, input)),
    {
      refresh: queryRefresh.routines, success: ({ input }) => `${input.name} saved.`, onSuccess: onSaved,
      signature: ({ routine, input }) => JSON.stringify([routine?.id ?? null, routine?.revision ?? null, input]),
    },
  );
}

export function useDeleteRoutine(onDeleted: () => void) {
  return useIdempotentDelete<Routine>((routine, key) => deleteRoutine(routine, key), {
    refresh: queryRefresh.routines, success: (routine) => `${routine.name} deleted. Workouts already logged from it stay.`, onSuccess: onDeleted,
  });
}
