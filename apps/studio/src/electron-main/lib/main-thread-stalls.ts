import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { heldMs } from "@instrument-org/shared/process-holds";

const log = createScopedLogger("mainThread");

/** How often the clock is checked; a tick this late or later is a stall. */
const TICK_MS = 100;
const STALL_MS = 250;
/**
 * How long a late tick waits before it is judged, so the freeze watchdog,
 * which checks every second, has counted a hold the tick spans.
 */
const HOLD_SETTLED_MS = 1_500;

/** RPC procedures in flight now, by call, so two calls of one path count twice. */
const running = new Map<symbol, string>();
/**
 * Every procedure that started or settled since the last tick: the moments a
 * handler's own code runs on this thread. A handler that blocks in a
 * synchronous call has usually settled by the time the late tick runs, so
 * what is in flight then would leave out the one that stalled, and a call
 * merely waiting on the network would be named beside every stall it spans.
 */
let ranSinceTick = new Set<string>();

/**
 * Records an RPC call for the stall log while it runs, for the RPC handler's
 * `clientInterceptors`. A stream counts until it is handed back, not for as
 * long as it stays open.
 */
export async function trackRPCForStalls<T>(options: {
  next: () => Promise<T>;
  path: readonly string[];
}): Promise<T> {
  const call = Symbol();
  const path = options.path.join(".");
  running.set(call, path);
  ranSinceTick.add(path);
  try {
    return await options.next();
  } finally {
    running.delete(call);
    ranSinceTick.add(path);
  }
}

/**
 * Logs a warning whenever the main thread goes `STALL_MS` or more without
 * getting to its timers, naming the RPC procedures that ran meanwhile.
 *
 * The main thread is also the one that hands every click and key to the
 * windows, so a stall here is a window that does not answer, even when the
 * renderer is free. Measured as the lateness of a repeating timer, which costs
 * nothing between stalls. A sleeping computer is not a stall: the time the
 * whole process was held (`heldMs`) is left out of a late tick, each hold
 * once. That covers full sleeps and a Mac's dark wakes alike: the power
 * monitor's `suspend` and `resume` never mark a dark wake, and a process
 * started during one never sees a `suspend` at all. `onTick` runs on every
 * tick, late or not, as the freeze watchdog's heartbeat.
 */
export function watchMainThreadStalls({ onTick }: { onTick: () => void }) {
  let last = performance.now();
  /** Held time already taken out of a late tick, so each hold is taken once. */
  let claimed = heldMs();
  const timer = setInterval(() => {
    onTick();
    const now = performance.now();
    const late = now - last - TICK_MS;
    last = now;
    const ran = ranSinceTick;
    ranSinceTick = new Set();
    if (late < STALL_MS) {
      return;
    }
    const during = describeStall(ran, running.values());
    const judge = setTimeout(() => {
      const held = Math.min(late, Math.max(0, heldMs() - claimed));
      claimed += held;
      const stalled = late - held;
      if (stalled >= STALL_MS) {
        log.warn(`Main thread stalled for ${Math.round(stalled)}ms`, during);
      }
    }, HOLD_SETTLED_MS);
    judge.unref();
  }, TICK_MS);
  timer.unref();
}

/**
 * Names what ran during a stall apart from what was only in flight across
 * it, since a call awaiting a reply holds no thread.
 */
export function describeStall(ran: Set<string>, inFlight: Iterable<string>) {
  const waiting = [...new Set(inFlight)].filter((path) => !ran.has(path));
  const during = ran.size > 0 ? `during ${[...ran].join(", ")}` : "outside RPC";
  return waiting.length > 0
    ? `${during} (in flight: ${waiting.join(", ")})`
    : during;
}
