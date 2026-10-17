import { z } from "zod";

export const occurredAtSchema = z.iso.datetime({ offset: true });

export const timeZoneSchema = z.string().min(1).refine((zone) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });

    return true;
  } catch {
    return false;
  }
});

export function localDate(instant: string, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) throw new Error("Could not calculate local date");

  return `${year}-${month}-${day}`;
}

// The zone's wall-clock time ("HH:MM") at an instant.
export function localTime(instant: string, zone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: zone, hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(new Date(instant));
}

export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);

  shifted.setUTCDate(shifted.getUTCDate() + days);

  return shifted.toISOString().slice(0, 10);
}

// The ISO weekday of a date: 1 Monday to 7 Sunday.
export function isoWeekday(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
}

// How far the zone's wall clock is ahead of UTC at an instant, in milliseconds.
function zoneOffset(zone: string, epoch: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(epoch));
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((candidate) => candidate.type === type)?.value);

  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second")) - Math.floor(epoch / 1000) * 1000;
}

// The instant a wall clock in the zone shows the date and time ("HH:MM"). The second pass settles times near a
// daylight saving change; a time skipped by the change lands just after it.
export function instantAt(date: string, time: string, zone: string): string {
  const wall = Date.parse(`${date}T${time}:00Z`);
  const guess = wall - zoneOffset(zone, wall);

  return new Date(wall - zoneOffset(zone, guess)).toISOString();
}
