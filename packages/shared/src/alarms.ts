/**
 * The one limit on warnings the app logs about how it behaves (a procedure
 * sending megabytes, a list read again whole, a part of the app writing its
 * log too fast). Each such warning has a key; a key warns at most once an
 * hour, and a launch logs at most `perLaunch` of them in all, then one line
 * saying the rest are held back. So however wrong the app goes, these
 * warnings cost the log a few dozen lines a launch.
 */

/** How often one key may warn. */
const EVERY_MS = 60 * 60_000;
/** How many warnings a launch logs before holding the rest back. */
const PER_LAUNCH = 40;
/** Keys remembered before new ones are held back, so the gate's memory has a bound. */
const MAX_KEYS = 1_000;

type Warn = (line: string) => void;

export function createAlarmGate({
  everyMs = EVERY_MS,
  maxKeys = MAX_KEYS,
  now = Date.now,
  perLaunch = PER_LAUNCH,
}: {
  everyMs?: number;
  maxKeys?: number;
  now?: () => number;
  perLaunch?: number;
} = {}) {
  const lastAt = new Map<string, number>();
  let raised = 0;
  let heldBack = false;
  return {
    /**
     * Logs `line` through `warn` unless `key` warned within the hour or the
     * launch has logged its share. Building the line is left to `line` so a
     * warning held back costs nothing. Says whether it logged.
     */
    raise(key: string, line: () => string, warn: Warn): boolean {
      const at = now();
      const last = lastAt.get(key);
      if (last !== undefined && at - last < everyMs) {
        return false;
      }
      if (last === undefined && lastAt.size >= maxKeys) {
        return false;
      }
      if (raised >= perLaunch) {
        if (!heldBack) {
          heldBack = true;
          warn(
            `Alarms: ${perLaunch} logged this launch; the rest are held back until the next one`,
          );
        }
        return false;
      }
      lastAt.set(key, at);
      raised += 1;
      warn(line());
      return true;
    },
  };
}

/** The gate every alarm in the process goes through. */
export const alarms = createAlarmGate();
