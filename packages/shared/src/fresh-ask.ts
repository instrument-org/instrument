/**
 * How long after another device asks this computer to act (send a reply a
 * phone wrote, take an answer given to an ask of this computer's) it still
 * acts on it. One asked longer ago than this, found by a launch the next
 * day say, or by a laptop opened an hour later, is left for the person to
 * act on again, so a computer coming back never starts work, and spends
 * usage, that nobody is watching for.
 *
 * Measured against the asking device's own clock on purpose: the question
 * is how long ago the person acted, which only that clock says. A skewed
 * clock moves the window by its skew; it never orders one record against
 * another.
 */
export const ASK_FRESH_MS = 10 * 60 * 1000;

/** Whether something asked at `at` (ms, or a Date) is still fresh at `now`. */
export function isFreshAsk(
  at: Date | number,
  now: number = Date.now(),
): boolean {
  return now - (typeof at === "number" ? at : at.getTime()) <= ASK_FRESH_MS;
}
