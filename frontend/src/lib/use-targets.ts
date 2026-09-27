import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { defaultTargets } from "../../../src/targets/contract";
import { getTargets, saveTargets, type Targets } from "./api";

export function useTargetsQuery(token: string, date: string) {
  return useQuery({ queryKey: ["targets", token, date], queryFn: () => getTargets(token, date), enabled: Boolean(token) });
}

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

// Saves the set taking effect on `date`; the web app passes today, so editing never rewrites the days behind you.
export function useSaveTargets(token: string, date: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (targets: Targets) => saveTargets(token, date, targets),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["targets"] }),
  });
}
