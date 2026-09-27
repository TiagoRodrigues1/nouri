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
