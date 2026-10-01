import { defaultTargets, targetsForDaySchema } from "../../../src/targets/contract";
import type { Targets } from "./api";
import { datedResource } from "./dated-resource";

export const { useDatedQuery: useTargetsQuery, useSaveDated: useSaveTargets } = datedResource<Targets, typeof targetsForDaySchema>("/v1/targets", "targets", targetsForDaySchema);

// A failed read is its own state rather than the defaults, so a screen never presents numbers the person did not set.
// Every state carries `targets`, so a screen reads it directly and compares only when it is there.
export type TargetsState =
  | { status: "ready"; targets: Targets }
  | { status: "loading"; targets?: undefined }
  | { status: "error"; targets?: undefined; message: string; retry: () => void };

// A disconnected log has no saved targets, so it measures against the defaults.
export function useTargets(token: string, date: string): TargetsState {
  const query = useTargetsQuery(token, date);

  if (!token) return { status: "ready", targets: defaultTargets };

  if (query.data) return { status: "ready", targets: query.data.targets };

  if (query.isError) return { status: "error", message: query.error.message, retry: () => void query.refetch() };

  return { status: "loading" };
}
