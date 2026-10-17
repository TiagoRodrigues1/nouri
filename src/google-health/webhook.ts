import { z } from "zod";
import { sameSecret } from "../crypto.js";
import type { ImportKind } from "../wearables/contract.js";
import type { ChangeNotice, ProviderWebhook } from "../wearables/provider.js";
import { shiftDate } from "../time.js";

// The data types Nouri subscribes to, and the kind each one changes. Active energy has no notification of its
// own, but it changes with steps, and the activity pull reads both.
// https://developers.google.com/health/webhooks
export const notifiedTypes = {
  sleep: "sleep",
  exercise: "workouts",
  steps: "activity",
  "heart-rate": "heartRate",
  "daily-resting-heart-rate": "heartRate",
} as const satisfies Record<string, ImportKind>;

const isNotified = (dataType: string): dataType is keyof typeof notifiedTypes => Object.hasOwn(notifiedTypes, dataType);

// Both forms start with the date, like "2026-07-14T00:00:00" (local) or "2026-07-14T07:00:00Z" (UTC).
const startDate = z.object({ startTime: z.string().transform((time) => time.slice(0, 10)).pipe(z.iso.date()) });

const intervalSchema = z.object({ physicalTimeInterval: startDate.optional(), civilIso8601TimeInterval: startDate.optional() });

// One notification. Google sends one object, or an array of up to 99 in a batch. Unknown fields pass through.
const notificationSchema = z.object({
  data: z.object({ healthUserId: z.string().min(1), dataType: z.string(), intervals: z.array(intervalSchema).optional() }),
});

// The earliest UTC date the intervals touch, a day early because a local date can lead UTC by one.
// A notification without a readable interval, such as some deletes, asks for the whole window.
function since(intervals: z.infer<typeof intervalSchema>[] = []): string | null {
  const dates = intervals.flatMap((interval) => {
    const date = interval.physicalTimeInterval?.startTime ?? interval.civilIso8601TimeInterval?.startTime;

    return date ? [date] : [];
  });

  if (dates.length === 0 || dates.length < intervals.length) return null;

  return shiftDate(dates.reduce((earliest, date) => date < earliest ? date : earliest), -1);
}

export function googleWebhook(secret: string): ProviderWebhook {
  // Google sends the configured secret verbatim as the Authorization header; register it as "Bearer <secret>".
  const expected = `Bearer ${secret}`;

  return {
    authorized: (authorization) => sameSecret(authorization, expected),
    read: async (request) => {
      const body: unknown = await request.json().catch(() => null);

      if (z.object({ type: z.literal("verification") }).safeParse(body).success) return "verification";
      const notices: ChangeNotice[] = [];

      // A notification Nouri cannot read is dropped rather than refused: Google would resend it for a week,
      // and reconciliation reads the same data anyway.
      for (const item of Array.isArray(body) ? body : [body]) {
        const notification = notificationSchema.safeParse(item);

        if (!notification.success || !isNotified(notification.data.data.dataType)) continue;
        const { healthUserId, dataType, intervals } = notification.data.data;

        notices.push({ accountId: healthUserId, kind: notifiedTypes[dataType], since: since(intervals) });
      }

      return notices;
    },
  };
}
