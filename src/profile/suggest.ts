import { targetLimits } from "../targets/contract.js";
import { ageLimits } from "./contract.js";
import type { Profile, Suggestion } from "./contract.js";

// Standard multipliers from resting to daily energy.
const activityFactor: Record<Profile["activity"], number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  "very-active": 1.9,
};

// Grams of protein per kilogram of body weight: higher while cutting to keep muscle, and while building it.
const proteinPerKg = { lose: 2, maintain: 1.6, gain: 1.8 };

// The usual estimate of the energy in a kilogram of body weight.
const kcalPerKg = 7700;

const fatShare = 0.3;

// The top of the usual protein range. Grams per kilogram alone could leave a short, heavy person on a cut with protein
// and fat over the energy target, so this keeps room for carbs.
const maxProteinShare = 0.35;

const waterPerKg = 35;

function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, step: number) {
  return Math.round(value / step) * step;
}

// Age on the day, from the year alone: at most a year off around birthdays, about 5 kcal of resting energy.
export function ageOn(birthYear: number, date: string): number {
  return Number(date.slice(0, 4)) - birthYear;
}

export function isAdultOn(birthYear: number, date: string): boolean {
  const age = ageOn(birthYear, date);

  return age >= ageLimits.min && age <= ageLimits.max;
}

export function suggestTargets(profile: Profile, body: { weightKg: number; heightCm: number }, date: string): Suggestion {
  const { weightKg, heightCm } = body;
  const age = ageOn(profile.birthYear, date);

  // Mifflin–St Jeor.
  const resting = 10 * weightKg + 6.25 * heightCm - 5 * age + (profile.sex === "male" ? 5 : -161);
  const maintenanceKcal = roundTo(resting * activityFactor[profile.activity], 10);
  const dailyChange = roundTo((profile.weeklyChangeKg * kcalPerKg) / 7, 10);

  // A cut never goes below resting energy.
  const kcal = clamp(Math.max(roundTo(resting, 10), maintenanceKcal + dailyChange), targetLimits.kcal);
  const direction = profile.weeklyChangeKg < 0 ? "lose" : profile.weeklyChangeKg > 0 ? "gain" : "maintain";
  const proteinG = clamp(Math.round(Math.min(weightKg * proteinPerKg[direction], (kcal * maxProteinShare) / 4)), targetLimits.proteinG);
  const fatG = clamp(Math.round((kcal * fatShare) / 9), targetLimits.fatG);
  const carbsG = clamp(Math.round((kcal - proteinG * 4 - fatG * 9) / 4), targetLimits.carbsG);
  const waterMl = clamp(roundTo(weightKg * waterPerKg, 50), targetLimits.waterMl);

  return {
    basis: { age, weightKg, heightCm, maintenanceKcal, expectedWeeklyChangeKg: Math.round(((kcal - maintenanceKcal) * 7 * 100) / kcalPerKg) / 100 },
    targets: { kcal, proteinG, carbsG, fatG, waterMl },
  };
}
