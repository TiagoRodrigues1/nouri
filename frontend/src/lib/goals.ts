// FDA reference daily values for a 2,000 kcal diet.
export const reference = { kcal: 2000, proteinG: 50, carbsG: 275, fatG: 78 };

export const fastingGoalHours = 16;

export const waterGoalMl = 2000;

export const sleepGoalMinutes = 480;

export const waterPresets = [
  { volumeMl: 250, label: "Glass" },
  { volumeMl: 500, label: "Bottle" },
] as const;
