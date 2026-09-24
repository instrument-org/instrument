/**
 * How long something has been going, in the finest unit that is still moving.
 *
 * Seconds stay on screen through the first hour, because these are read while
 * they run: a duration that settles on `1m` and then says `1m` for the next
 * fifty-nine seconds looks like a stopped clock, which is the opposite of what
 * a live process wants to say. Past an hour the seconds are noise and the
 * minutes carry it.
 */
export function formatElapsed(startedAt: Date, now: number): string {
  const total = Math.max(0, Math.round((now - startedAt.getTime()) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
