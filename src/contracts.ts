export type Brand<T, Name extends string> = T & { readonly __brand: Name };

export type UserId = Brand<string, "UserId">;

export type EntryId = Brand<string, "EntryId">;

export type SuggestionId = Brand<string, "SuggestionId">;

export type Instant = Brand<string, "ISO8601Instant">;

export type LocalDate = Brand<string, "ISO8601Date">;

export type IanaTimeZone = Brand<string, "IanaTimeZone">;

export type Source =
  | { kind: "manual"; deviceId: string }
  | { kind: "wearable"; provider: "healthkit" | "health-connect"; externalId: string };

export type FoodQuantity =
  | { amount: number; unit: "g" | "ml" }
  | { amount: number; unit: "serving"; servingSize: { amount: number; unit: "g" | "ml" } };

export type FoodPortion = {
  name: string;
  quantity: FoodQuantity;
  nutrients: { kcal: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null };
  catalogRef?: { provider: "ciqual" | "usda-fdc" | "portfir" | "open-food-facts"; id: string; version?: string };
};

export type FoodCandidate = {
  ref: NonNullable<FoodPortion["catalogRef"]>;
  name: string;
  language: string;
  kind: "generic" | "packaged";
  basis: "per-100-g" | "per-100-ml";
  nutrients: FoodPortion["nutrients"];
  barcode?: string;
  serving?: { amount: number; unit: "g" | "ml" };
};

export type StrengthWorkout = {
  startedAt: Instant;
  endedAt: Instant;
  exercises: Array<{ name: string; sets: Array<{ reps: number; loadKg?: number; durationSeconds?: number }> }>;
};

export type CardioSession = {
  activity: "run" | "walk" | "cycle" | "other";
  startedAt: Instant;
  endedAt: Instant;
  distanceMeters?: number;
  energyKcalEstimate?: number;
};

export type SleepSession = {
  startedAt: Instant;
  endedAt: Instant;
  stages?: Array<{ kind: "awake" | "light" | "deep" | "rem"; startedAt: Instant; endedAt: Instant }>;
};

export type JournalInput =
  | { kind: "food"; occurredAt: Instant; timeZone: IanaTimeZone; value: FoodPortion }
  | { kind: "water"; occurredAt: Instant; timeZone: IanaTimeZone; value: { volumeMl: number } }
  | { kind: "supplement"; occurredAt: Instant; timeZone: IanaTimeZone; value: { name: string; amount: number; unit: string } }
  | { kind: "strength"; occurredAt: Instant; timeZone: IanaTimeZone; value: StrengthWorkout }
  | { kind: "cardio"; occurredAt: Instant; timeZone: IanaTimeZone; value: CardioSession };

export type WearableChange =
  | { operation: "upsert"; source: Extract<Source, { kind: "wearable" }>; sourceRevision: string; timeZone: IanaTimeZone; value: { kind: "sleep"; data: SleepSession } | { kind: "cardio"; data: CardioSession } }
  | { operation: "delete"; source: Extract<Source, { kind: "wearable" }> };

export type RecordedEntry = { id: EntryId; revision: number; source: Source; occurredAt: Instant; timeZone: IanaTimeZone };

export type DayEvidence = {
  date: LocalDate;
  timeZone: IanaTimeZone;
  foodKcal: number | null;
  proteinG: number | null;
  waterMl: number | null;
  workouts: number;
  cardioMinutes: number;
  sleepMinutes: number | null;
  completeness: Array<{ kind: string; status: "present" | "missing" | "stale" }>;
  evidenceRefs: Array<{ entryId: EntryId; revision: number }>;
  snapshotHash: string;
};

export type Suggestion = {
  id: SuggestionId;
  kind: "rest" | "workout" | "nutrition" | "hydration";
  message: string;
  reason: string;
  evidenceRefs: DayEvidence["evidenceRefs"];
  uncertainty: string | null;
  status: "current" | "stale" | "accepted" | "dismissed";
  proposedAction?: { kind: "goal-change"; targetKcal: number };
};

export interface Journal {
  record(userId: UserId, input: JournalInput, idempotencyKey: string): Promise<RecordedEntry>;
  revise(userId: UserId, id: EntryId, expectedRevision: number, input: JournalInput, idempotencyKey: string): Promise<RecordedEntry>;
  remove(userId: UserId, id: EntryId, expectedRevision: number, idempotencyKey: string): Promise<void>;
}

export interface Foods {
  search(query: string, locale: string): Promise<{ items: FoodCandidate[]; attribution: Array<{ provider: FoodCandidate["ref"]["provider"]; label: string; url: string }> }>;
  findByBarcode(barcode: string): Promise<FoodCandidate | null>;
}

export interface Wearables {
  applyChanges(userId: UserId, changes: WearableChange[], idempotencyKey: string): Promise<{ applied: number; unchanged: number }>;
}

export interface Days {
  getDay(userId: UserId, date: LocalDate, zone: IanaTimeZone): Promise<DayEvidence>;
}

export interface Coaching {
  generate(userId: UserId, date: LocalDate): Promise<Suggestion[]>;
  respond(userId: UserId, id: SuggestionId, response: "accepted" | "dismissed"): Promise<Suggestion>;
}
