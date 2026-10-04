import { targetsForDaySchema } from "../../../src/targets/contract";
import type { Targets } from "./api";
import { datedResource } from "./dated-resource";

// Review compares each day with its targets, so saving refreshes it too.
export const { useDatedQuery: useTargetsQuery, useSaveDated: useSaveTargets } = datedResource<Targets, typeof targetsForDaySchema>("/v1/targets", "targets", targetsForDaySchema, { refresh: ["review"] });
