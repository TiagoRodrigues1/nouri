import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { error } from "./http-error.js";

export const minute = 60_000;

export const hour = 60 * minute;

export const day = 24 * hour;

export const mib = 1024 * 1024;

export type UsageBudget = { key: string; maximum: number; duration: number; amount?: number };

// Check every allowance before committing any. Failed admissions never leave partially charged quotas.
export function usageWindows(now = Date.now) {
  const windows = new Map<string, { used: number; expiresAt: number }>();

  function reserve(budgets: UsageBudget[]): boolean {
    const time = now();
    const pending = new Map<string, { used: number; expiresAt: number }>();

    for (const { key, maximum, duration, amount = 1 } of budgets) {
      const stored = pending.get(key) ?? windows.get(key);
      const window = stored && stored.expiresAt > time ? stored : { used: 0, expiresAt: time + duration };

      if (window.used + amount > maximum || (amount === 0 && window.used >= maximum)) return false;
      pending.set(key, { used: window.used + amount, expiresAt: window.expiresAt });
    }

    const newKeys = [...pending.keys()].filter((key) => !windows.has(key));

    if (windows.size + newKeys.length > 10_000) {
      for (const [key, stored] of windows) if (stored.expiresAt <= time) windows.delete(key);
      const missing = [...pending.keys()].filter((key) => !windows.has(key)).length;

      if (windows.size + missing > 10_000) return false;
    }

    for (const [key, window] of pending) windows.set(key, window);

    return true;
  }

  return Object.assign(
    (key: string, maximum: number, duration: number, amount = 1) => reserve([{ key, maximum, duration, amount }]),
    { reserve },
  );
}

export type UsageWindows = ReturnType<typeof usageWindows>;

export function limited(message: string, retryAfter: number): Response {
  const response = error(429, message);
  response.headers.set("Retry-After", String(retryAfter));
  response.headers.set("Cache-Control", "no-store");

  return response;
}

export type CallerVariables = { Variables: { clerkUserId: string | undefined } };

// Feature routes supply admission and body policy; this middleware only owns process resources. It identifies the
// caller first, locally, so anonymous traffic draws from its own budgets and cannot lock out signed-in people.
export function requestLimits(consume: UsageWindows, policy: {
  identify: (request: Request) => Promise<string | null>;
  admit: (method: string, path: string, clerkUserId: string | null) => Response | null;
  // Requests that reach the database or a provider, as opposed to the page and its files.
  costly: (path: string) => boolean;
  bodySize: (method: string, path: string) => number;
}): MiddlewareHandler<CallerVariables> {
  let activeRequests = 0;
  let anonymousRequests = 0;
  // In-flight handlers per signed-in person; absent means none.
  const callerRequests = new Map<string, number>();

  const reserveTraffic = (amount: number) => consume.reserve([
    { key: "response-bytes-day", maximum: 4 * 1024 * mib, duration: day, amount },
    { key: "response-bytes-month", maximum: 20 * 1024 * mib, duration: 30 * day, amount },
  ]);

  return async (context, next) => {
    if (!reserveTraffic(0)) return limited("The app's download allowance has been reached. Try again later.", 86400);

    if ((context.req.header("Authorization")?.length ?? 0) > 16_384) return error(431, "Authorization header is too large");
    const clerkUserId = await policy.identify(context.req.raw);
    const anonymous = clerkUserId === null;
    const shared = anonymous && policy.costly(context.req.path);

    // Eight handlers stay free for signed-in people however busy anonymous API traffic keeps the rest. The page and
    // its files take milliseconds and may use all 32, so a page loading its chunks at once is not refused.
    // No one signed-in person may hold more than 8, so slow uploads from one account cannot fill the rest either.
    const busy = activeRequests >= 32 || (shared && anonymousRequests >= 24) || (clerkUserId !== null && (callerRequests.get(clerkUserId) ?? 0) >= 8);

    // Each person's share is reserved with the pool, so an account past its share is refused without draining it.
    const pool = clerkUserId === null
      ? [{ key: "requests", maximum: 3000, duration: minute }]
      : [{ key: `pool-share:${clerkUserId}`, maximum: 180, duration: minute }, { key: "account-requests", maximum: 3000, duration: minute }];

    if (busy || !consume.reserve(pool)) return limited("Too many requests. Try again shortly.", 60);
    const refused = policy.admit(context.req.method, context.req.path, clerkUserId);

    if (refused) return refused;
    context.set("clerkUserId", clerkUserId ?? undefined);
    activeRequests++;

    if (shared) anonymousRequests++;

    if (clerkUserId !== null) callerRequests.set(clerkUserId, (callerRequests.get(clerkUserId) ?? 0) + 1);

    try {
      const rejected = await bodyLimit({ maxSize: policy.bodySize(context.req.method, context.req.path), onError: () => error(413, "Request body is too large") })(context, next);

      if (rejected) return rejected;

      if (context.res.body) context.res = new Response(budgetedBody(context.res.body, reserveTraffic), context.res);
    } finally {
      activeRequests--;

      if (shared) anonymousRequests--;

      if (clerkUserId !== null) {
        const remaining = (callerRequests.get(clerkUserId) ?? 1) - 1;

        if (remaining > 0) callerRequests.set(clerkUserId, remaining);
        else callerRequests.delete(clerkUserId);
      }
    }
  };
}

// Stream errors cancel the source, including a running account export.
export function budgetedBody(source: ReadableStream<Uint8Array>, reserve: (bytes: number) => boolean): ReadableStream<Uint8Array> {
  return source.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (!reserve(chunk.byteLength)) throw new Error("Download allowance reached");
      controller.enqueue(chunk);
    },
  }));
}
