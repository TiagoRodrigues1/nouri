import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { z } from "zod";
import { recordPaths } from "../../../src/journal/paths";
import { ApiError, createRecord, type Routine } from "./api";
import { queryRefresh } from "./query-refresh";
import { timeZone } from "./time";
import { reduce, sessionDate, sessionSchema, startSession, toWorkoutInput, type Session, type SessionAction } from "./workout-session";

// Later versions join this union with a transform that upgrades the older ones.
const storedSchema = z.object({ version: z.literal(1), session: sessionSchema });

type Stored = { kind: "empty" } | { kind: "session"; session: Session } | { kind: "unreadable" };

export function parseStored(raw: string | null): Stored {
  if (raw === null) return { kind: "empty" };

  try {
    const parsed = storedSchema.safeParse(JSON.parse(raw));

    return parsed.success ? { kind: "session", session: parsed.data.session } : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
}

const listeners = new Set<() => void>();

// Finish requests in flight in this tab, by key, so every component shares one and a mount never sends twice.
const sending = new Map<string, Promise<FinishOutcome>>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

const snapshots = new Map<string, { raw: string | null; stored: Stored }>();

// The same object while the stored text is unchanged, as useSyncExternalStore needs.
function read(storageKey: string): Stored {
  const raw = localStorage.getItem(storageKey);
  const cached = snapshots.get(storageKey);

  if (cached && cached.raw === raw) return cached.stored;
  const stored = parseStored(raw);

  snapshots.set(storageKey, { raw, stored });

  return stored;
}

function writeSession(storageKey: string, session: Session) {
  localStorage.setItem(storageKey, JSON.stringify({ version: 1, session }));
  notify();
}

// Only the session it names, so a slow Finish never removes a workout another tab started since.
function clear(storageKey: string, sessionId: string | null) {
  const stored = read(storageKey);

  if (sessionId !== null && (stored.kind !== "session" || stored.session.id !== sessionId)) return;
  localStorage.removeItem(storageKey);
  notify();
}

// Each action applies to what is stored now, other tabs' changes included, so tabs merge action by action.
function apply(storageKey: string, action: SessionAction) {
  const stored = read(storageKey);

  if (stored.kind !== "session") return;
  const next = reduce(stored.session, action);

  if (next !== stored.session) writeSession(storageKey, next);
}

type FinishOutcome = "saved" | "rejected" | "unknown";

// Sends the frozen request until the server answers. Only a stored workout clears the draft. A 400 or 413 means
// nothing was stored, so the draft opens for editing again; any other failure may have stored it, so the same key
// and body go again.
function send(storageKey: string, session: Session, client: QueryClient): Promise<FinishOutcome> {
  const finish = session.finish;

  if (!finish) return Promise.resolve("rejected");
  const inFlight = sending.get(finish.key);

  if (inFlight) return inFlight;

  const request = createRecord(finish.key, { path: recordPaths.workout, input: finish.input }).then(
    async (): Promise<FinishOutcome> => {
      clear(storageKey, session.id);
      toast.success(`${session.title} saved.`);
      await Promise.all(queryRefresh.workout.map((name) => client.invalidateQueries({ queryKey: [name] })));

      return "saved";
    },
    (error: Error): FinishOutcome => {
      toast.error(error.message);

      if (error instanceof ApiError && (error.status === 400 || error.status === 413)) {
        apply(storageKey, { type: "thaw" });

        return "rejected";
      }

      return "unknown";
    },
  ).finally(() => {
    sending.delete(finish.key);
    notify();
  });

  sending.set(finish.key, request);
  notify();

  return request;
}

export type StartResult = { outcome: "started" | "in-progress"; session: Session };

// The add actions as callers write them: the new ids are minted here.
type NewAction =
  | { type: "add-set"; exerciseId: string }
  | { type: "add-exercise"; name: string };

type EditAction = Exclude<SessionAction, { type: "add-set" | "add-exercise" | "freeze" | "thaw" }>;

export type WorkoutSessionHandle = {
  session: Session | null;
  // Stored data that cannot be read: the page offers only Discard, so a workout is never dropped silently.
  unreadable: boolean;
  dispatch: (action: EditAction | NewAction) => void;
  start: (routine: Routine | null) => StartResult;
  discard: () => void;
  finish: {
    // Freezes the request into the draft, then sends it. Resolves with the workout's date once it is stored.
    save: (durationMinutes: number) => Promise<string | null>;
    retry: () => Promise<string | null>;
    isPending: boolean;
  };
};

// The account's one workout in progress, shared by every component and every tab.
export function useWorkoutSession(): WorkoutSessionHandle {
  const { userId } = useAuth();
  const client = useQueryClient();
  const storageKey = `nouri.workout-session.${userId ?? "signed-out"}`;
  const stored = useSyncExternalStore(subscribe, () => read(storageKey));
  const session = stored.kind === "session" ? stored.session : null;
  const isPending = useSyncExternalStore(subscribe, () => (session?.finish ? sending.has(session.finish.key) : false));

  const dispatch = useCallback((action: EditAction | NewAction) => {
    if (action.type === "add-set") apply(storageKey, { ...action, setId: crypto.randomUUID() });
    else if (action.type === "add-exercise") apply(storageKey, { ...action, exerciseId: crypto.randomUUID(), setId: crypto.randomUUID() });
    else apply(storageKey, action);
  }, [storageKey]);

  const start = useCallback((routine: Routine | null): StartResult => {
    const current = read(storageKey);

    if (current.kind === "session") return { outcome: "in-progress", session: current.session };
    const started = startSession(routine, new Date().toISOString(), timeZone, () => crypto.randomUUID());

    writeSession(storageKey, started);

    return { outcome: "started", session: started };
  }, [storageKey]);

  const discard = useCallback(() => clear(storageKey, null), [storageKey]);

  const retry = useCallback(async () => {
    const current = read(storageKey);

    if (current.kind !== "session" || !current.session.finish) return null;

    return (await send(storageKey, current.session, client)) === "saved" ? sessionDate(current.session) : null;
  }, [storageKey, client]);

  const save = useCallback(async (durationMinutes: number) => {
    const current = read(storageKey);

    if (current.kind !== "session") return null;
    apply(storageKey, { type: "freeze", finish: { key: crypto.randomUUID(), input: toWorkoutInput(current.session, durationMinutes) } });

    return retry();
  }, [storageKey, retry]);

  return { session, unreadable: stored.kind === "unreadable", dispatch, start, discard, finish: { save, retry, isPending } };
}

// A Finish whose answer never came, after a reload, a killed tab, or signing in again, sends itself once.
export function useResumeFinish() {
  const { session, finish: { retry } } = useWorkoutSession();
  const key = session?.finish?.key;

  useEffect(() => {
    if (key) void retry();
  }, [key, retry]);
}

// Re-renders every `interval` ms while mounted, for clocks derived from a start time.
export function useNow(interval: number): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), interval);

    return () => clearInterval(timer);
  }, [interval]);

  return now;
}
