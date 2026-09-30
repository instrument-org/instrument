const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The time on a row: how long ago while that still means something, then the
 * date. Today and yesterday are read in the terms a person thinks in ("20m",
 * "3h"); past that a clock time is no help and the date is what they are
 * looking for.
 */
export function taskTimeLabel(date: Date, now: Date): string {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const days = Math.floor((startOfToday - date.getTime()) / DAY_MS);
  if (days < 1) {
    const minutes = Math.max(
      0,
      Math.round((now.getTime() - date.getTime()) / 60_000),
    );
    if (minutes < 1) {
      return "now";
    }
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.round(minutes / 60);
    return `${hours}h`;
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
