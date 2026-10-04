import { recordPaths } from "../../../src/journal/paths";

// A record kind owns the list of reads that include it.
export const queryRefresh = {
  food: ["day", "overview", "review", "recent-foods"],
  water: ["day", "overview"],
  workout: ["overview", "review", "workout-summary", "exercise-history"],
  sleep: ["overview", "review"],
  measurement: ["overview", "review"],
  photo: ["overview"],
  supplements: ["day", "overview"],
} as const;

export const recordQueryRefresh = {
  [recordPaths.water]: queryRefresh.water,
  [recordPaths.workout]: queryRefresh.workout,
  [recordPaths.sleep]: queryRefresh.sleep,
  [recordPaths.measurement]: queryRefresh.measurement,
  [recordPaths.photo]: queryRefresh.photo,
  [recordPaths.supplementIntake]: queryRefresh.supplements,
  [recordPaths.supplementStack]: queryRefresh.supplements,
} as const;
