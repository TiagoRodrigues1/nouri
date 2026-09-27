// Pieces every Google Health data point shares, whatever its type.

// Seconds in a Google Duration string such as "-14400s".
export function durationSeconds(duration: string | undefined): number | null {
  if (duration === undefined) return null;

  return Math.round(Number(duration.slice(0, -1)));
}

// Google reports a UTC offset, not a named zone, so an imported record keeps the offset, like "-04:00".
export function offsetZone(offset: string | undefined): string {
  const seconds = durationSeconds(offset);

  if (seconds === null) return "UTC";
  const sign = seconds < 0 ? "-" : "+";
  const minutes = Math.abs(Math.round(seconds / 60));

  return `${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function deviceName(dataSource: { device?: { manufacturer?: string | undefined; model?: string | undefined } | undefined } | undefined): string | null {
  const device = dataSource?.device;

  return device?.model?.trim() || device?.manufacturer?.trim() || null;
}
