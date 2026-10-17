import { z } from "zod";

export const suggestionKinds = ["log-food", "protein", "calories", "water", "sleep", "supplements"] as const;

// One suggestion and the evidence it rests on, phrased for the person.
export const suggestionSchema = z.object({
  kind: z.enum(suggestionKinds),
  title: z.string(),
  because: z.string(),
});

export type Suggestion = z.infer<typeof suggestionSchema>;

// The thresholds are product policy, named here rather than buried in the rules.
export const coachingPolicy = {
  // A week needs this many days with a value before Nouri suggests anything about it.
  minEvidenceDays: 4,
  // Sleep this far under target on average is short.
  sleepShortfallMinutes: 30,
} as const;
