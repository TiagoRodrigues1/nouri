import { z } from "zod";
import { measurementLimits } from "../measurements/contract.js";
import { targetsSchema } from "../targets/contract.js";

// The two branches of the Mifflin–St Jeor resting energy formula.
export const sexes = ["female", "male"] as const;

export const activityLevels = ["sedentary", "light", "moderate", "active", "very-active"] as const;

export const goalDirections = ["lose", "maintain", "gain"] as const;

// The formula is for adults, so the form asks for an age in this range and stores the birth year.
export const ageLimits = { min: 18, max: 100 } as const;

export const profileSchema = z.object({
  sex: z.enum(sexes),
  // Stored instead of an age, which would go stale.
  birthYear: z.number().int().min(1900).max(2100),
  activity: z.enum(activityLevels),
  goal: z.enum(goalDirections),
}).strict();

// Body size and goal set these; the rest of the targets are preferences a suggestion leaves alone.
export const suggestedTargetsSchema = targetsSchema.pick({ kcal: true, proteinG: true, carbsG: true, fatG: true, waterMl: true });

export const suggestionSchema = z.object({
  // What the numbers came from, so the person can see why they were suggested.
  basis: z.object({
    age: z.number().int(),
    weightKg: z.number().min(measurementLimits.weight.min).max(measurementLimits.weight.max),
    heightCm: z.number().min(measurementLimits.height.min).max(measurementLimits.height.max),
    maintenanceKcal: z.number().int(),
  }),
  targets: suggestedTargetsSchema,
});

// What a suggestion is made from.
export const profileNeeds = ["profile", "weight", "height"] as const;

export const profileViewSchema = z.object({
  profile: profileSchema.nullable(),
  suggestion: suggestionSchema.nullable(),
  // What the suggestion still needs; empty exactly when there is one.
  missing: z.array(z.enum(profileNeeds)),
});

export type Profile = z.infer<typeof profileSchema>;

export type Suggestion = z.infer<typeof suggestionSchema>;

export type SuggestedTargets = z.infer<typeof suggestedTargetsSchema>;

export type ProfileView = z.infer<typeof profileViewSchema>;
