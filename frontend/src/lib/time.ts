// Times of day in the browser's zone, for the current time and for records read where they are shown.
export const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

const zoneClocks = new Map<string, Intl.DateTimeFormat>();

// A logged food is read in the zone it was logged in, so a meal keeps its hour after you travel.
function entryClock(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneClocks.get(timeZone);

  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone });
    zoneClocks.set(timeZone, formatter);
  }

  return formatter;
}

type Logged = { occurredAt: string; timeZone: string };

export function entryTime({ occurredAt, timeZone }: Logged): string {
  return entryClock(timeZone).format(new Date(occurredAt));
}

export function entryHour({ occurredAt, timeZone }: Logged): number {
  return Number(entryClock(timeZone).formatToParts(new Date(occurredAt)).find((part) => part.type === "hour")?.value);
}

export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// `time` is a local "HH:MM"; without it the current time of day is used.
export function occurredAt(value: string, time?: string): string {
  const [y = 0, m = 1, d = 1] = value.split("-").map(Number);
  const now = new Date();

  if (time) {
    const [hours = 0, minutes = 0] = time.split(":").map(Number);

    return new Date(y, m - 1, d, hours, minutes).toISOString();
  }

  return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds()).toISOString();
}

export function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function shiftDate(value: string, days: number): string {
  const [y = 0, m = 1, d = 1] = value.split("-").map(Number);

  return localDate(new Date(y, m - 1, d + days));
}

export function dateLabel(value: string): string {
  const [y = 0, m = 1, d = 1] = value.split("-").map(Number);

  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(y, m - 1, d));
}

export function currentTime(now = new Date()): string {
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export function calendarDate(value: string): Date {
  const [y = 0, m = 1, d = 1] = value.split("-").map(Number);

  return new Date(y, m - 1, d);
}

const shortDay = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short" });

// "Mon, Sep 28", for one row of a timeline.
export function shortDayLabel(value: string): string {
  return shortDay.format(calendarDate(value));
}

// The `days` days ending on `value`: "Last 7 days" when it is today, otherwise the range.
export function rangeLabel(value: string, days: number, isToday: boolean): string {
  if (isToday) return `Last ${days} days`;

  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" }).formatRange(calendarDate(shiftDate(value, 1 - days)), calendarDate(value));
}
