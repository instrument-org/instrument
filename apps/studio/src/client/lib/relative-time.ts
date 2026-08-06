import { format, formatDistance, isSameYear } from "date-fns";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Past this age a distance stops carrying information ("8 months ago" answers
 * nothing "Nov 3" doesn't answer better), so the rendering switches to the date
 * itself and stops needing to tick at all.
 */
export const RELATIVE_TIME_MAX_AGE_MS = 7 * DAY_MS;

/** The full timestamp behind a relative rendering, for tooltips and titles. */
export function formatAbsoluteTime(date: Date) {
  return format(date, "PPpp");
}

/**
 * One instant, rendered the way the whole app renders instants. `now` is passed
 * in rather than read here so that a caller ticking on the shared clock and a
 * caller formatting a one-off string agree, and so the branch points are
 * testable without faking time.
 *
 * date-fns spells short distances as "less than a minute ago" and hedges the
 * hour scale with "about", both of which read as noise at the sizes these
 * appear in; the two rewrites below are what every call site used to do for
 * itself, in four different combinations.
 */
export function formatRelativeTime(
  date: Date,
  now: number,
  { maxAgeMs = RELATIVE_TIME_MAX_AGE_MS }: { maxAgeMs?: number } = {},
) {
  const nowDate = new Date(now);

  if (now - date.getTime() >= maxAgeMs) {
    return format(date, isSameYear(date, nowDate) ? "MMM d" : "MMM d, yyyy");
  }

  return formatDistance(date, nowDate, { addSuffix: true })
    .replace("less than a minute", "< 1 minute")
    .replace("about ", "");
}

/**
 * How often a rendering of this age can actually change on screen. Cadence
 * follows the unit being displayed: re-rendering an hours-old timestamp every
 * minute is 60 renders to change a string once, and a date past
 * {@link RELATIVE_TIME_MAX_AGE_MS} never changes again, so it returns null and
 * that instance stops subscribing entirely.
 *
 * Future dates (clock skew against a file's mtime, mostly) tick at their
 * distance from now like any other.
 */
export function relativeTickMs(
  ageMs: number,
  { maxAgeMs = RELATIVE_TIME_MAX_AGE_MS }: { maxAgeMs?: number } = {},
): null | number {
  if (ageMs >= maxAgeMs) {
    return null;
  }

  const age = Math.abs(ageMs);

  if (age < MINUTE_MS) {
    return 5 * SECOND_MS;
  }
  if (age < HOUR_MS) {
    return MINUTE_MS;
  }
  return 5 * MINUTE_MS;
}

/**
 * One timer per distinct cadence for the whole app, rather than one per
 * rendered timestamp: a file list and a task table together run to hundreds of
 * instances, and they all want to hear the same handful of moments.
 */
const subscribers = new Map<number, Set<() => void>>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const subscribeFns = new Map<number, (onChange: () => void) => () => void>();

let sharedNow = Date.now();
let watchingVisibility = false;

/**
 * The `subscribe` half of a `useSyncExternalStore` pair, stable per cadence so
 * that a component re-rendering on every tick does not resubscribe on every
 * tick. Identity changes only when the instance crosses into a different
 * cadence, which is exactly when it should move to another timer.
 */
export function clockSubscriber(intervalMs: number) {
  const existing = subscribeFns.get(intervalMs);
  if (existing) {
    return existing;
  }

  const subscribe = (onChange: () => void) => {
    watchVisibility();

    // Nothing advances the shared clock while no timestamp is mounted, so the
    // first subscriber after a quiet stretch reads it forward before any timer
    // would have.
    sharedNow = Date.now();

    const forInterval = subscribers.get(intervalMs) ?? new Set();
    subscribers.set(intervalMs, forInterval);
    forInterval.add(onChange);

    if (!timers.has(intervalMs)) {
      schedule(intervalMs);
    }

    return () => {
      forInterval.delete(onChange);
      if (forInterval.size === 0) {
        subscribers.delete(intervalMs);
        clearTimer(intervalMs);
      }
    };
  };

  subscribeFns.set(intervalMs, subscribe);
  return subscribe;
}

export function getSharedNow() {
  return sharedNow;
}

function clearTimer(intervalMs: number) {
  const timer = timers.get(intervalMs);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(intervalMs);
  }
}

function notify(intervalMs: number) {
  for (const onChange of subscribers.get(intervalMs) ?? []) {
    onChange();
  }
}

/**
 * Aligned to the wall-clock boundary of its own cadence rather than to whenever
 * the first subscriber mounted, so a minute-scale timestamp flips when the
 * minute flips. Unaligned, "1 minute ago" can sit on screen for nearly two.
 */
function schedule(intervalMs: number) {
  const delay = intervalMs - (Date.now() % intervalMs);
  timers.set(
    intervalMs,
    setTimeout(() => {
      sharedNow = Date.now();
      notify(intervalMs);
      schedule(intervalMs);
    }, delay),
  );
}

/**
 * Chromium throttles a hidden window's timers on its own, so the timers here
 * are left to run rather than torn down and stood back up -- that saves little
 * and turns a pause into something that depends on an event to undo it.
 *
 * What a throttled tick does cost is accuracy: the wall clock can move much
 * further than the last tick saw, so returning to the window re-reads it and
 * notifies. That makes the first frame back current instead of up to a
 * throttling interval stale.
 */
function watchVisibility() {
  if (watchingVisibility || typeof document === "undefined") {
    return;
  }
  watchingVisibility = true;

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      return;
    }

    sharedNow = Date.now();
    for (const intervalMs of subscribers.keys()) {
      notify(intervalMs);
    }
  });
}
