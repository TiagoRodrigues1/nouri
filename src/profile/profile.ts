import { eq } from "drizzle-orm";
import type { AppDatabase } from "../db/database.js";
import { userProfiles } from "../db/schema.js";
import { getLatestMeasurements } from "../measurements/measurements.js";
import { profileNeeds } from "./contract.js";
import type { Profile, ProfileView } from "./contract.js";
import { isAdultOn, suggestTargets } from "./suggest.js";

// The saved profile and the targets it suggests on the day, from the weight and height in force then.
export async function getProfileView(db: AppDatabase, userId: string, date: string): Promise<ProfileView> {
  const [[row], latest] = await Promise.all([
    db.select().from(userProfiles).where(eq(userProfiles.userId, userId)),
    getLatestMeasurements(db, userId, date),
  ]);

  const profile: Profile | null = row ? { sex: row.sex, birthYear: row.birthYear, activity: row.activity, goal: row.goal } : null;
  const adult = profile !== null && isAdultOn(profile.birthYear, date);
  // Without a profile there is no age to judge, so only the profile is reported missing.
  const has = { profile: profile !== null, age: profile === null || adult, weight: latest.weight !== null, height: latest.height !== null };
  const missing = profileNeeds.filter((need) => !has[need]);

  const suggestion = profile && adult && latest.weight && latest.height
    ? suggestTargets(profile, { weightKg: latest.weight.value, heightCm: latest.height.value }, date)
    : null;

  return { profile, suggestion, missing };
}

// A full replacement of the profile, so repeating it changes nothing. Returns the view for the day it was saved from.
export async function saveProfile(db: AppDatabase, userId: string, date: string, profile: Profile): Promise<ProfileView> {
  await db.insert(userProfiles).values({ userId, ...profile })
    .onConflictDoUpdate({ target: userProfiles.userId, set: { ...profile, updatedAt: new Date() } });

  return getProfileView(db, userId, date);
}
