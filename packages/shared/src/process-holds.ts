/**
 * Time the whole process was held: the computer asleep, including the
 * stretches between a Mac's dark wakes, or the system napping the app.
 * Node's clock (`performance.now()`, and every timer) keeps counting through
 * a hold on macOS, and a process the system starts during a dark wake (an
 * update installed unattended) never gets the power monitor's `suspend` or
 * `resume`, so a duration measured across a hold reads as minutes of work.
 * Subtract what this says to measure only the time the process could run.
 *
 * The desktop app measures holds from a worker thread whose own timer comes
 * late with main's (`main-thread-freezes.ts`); anywhere nothing measures
 * them, holds read as none.
 */

let read: () => number = () => 0;

/** Total milliseconds the process has been held since holds were first measured. */
export function heldMs(): number {
  return read();
}

/** Sets where `heldMs` reads from, once, at startup. */
export function measureHoldsWith(source: () => number): void {
  read = source;
}

/** `performance.now()` with the time the process was held left out, for durations. */
export function awakeNow(): number {
  return performance.now() - heldMs();
}

/**
 * Milliseconds the process could run since `start`, an `awakeNow()` reading.
 * Never below zero: a hold the watchdog counts a moment after the wake can
 * come out of a duration that only began at the wake.
 */
export function awakeMsSince(start: number): number {
  return Math.max(0, awakeNow() - start);
}
