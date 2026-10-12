import { createScopedLogger } from "@/electron-main/lib/electron-logger";
import { powerMonitor } from "electron";

const log = createScopedLogger("mainThread");

/** How often the clock is checked; a tick this late or later is a stall. */
const TICK_MS = 100;
const STALL_MS = 250;

/** RPC procedures running now, by call, so two calls of one path count twice. */
const running = new Map<symbol, string>();
/**
 * Every procedure that ran at some point since the last tick. A handler that
 * blocks in a synchronous call has usually finished by the time the late tick
 * runs, so what is running then would leave out the one that stalled.
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
  }
}

/**
 * Logs a warning whenever the main thread goes `STALL_MS` or more without
 * getting to its timers, naming the RPC procedures that ran meanwhile.
 *
 * The main thread is also the one that hands every click and key to the
 * windows, so a stall here is a window that does not answer, even when the
 * renderer is free. Measured as the lateness of a repeating timer, which costs
 * nothing between stalls; a sleeping computer is not a stall.
 */
export function watchMainThreadStalls() {
  let last = performance.now();
  let isSuspended = false;
  powerMonitor.on("suspend", () => {
    isSuspended = true;
  });
  powerMonitor.on("resume", () => {
    isSuspended = false;
    last = performance.now();
  });
  const timer = setInterval(() => {
    const now = performance.now();
    const late = now - last - TICK_MS;
    last = now;
    const ran = ranSinceTick;
    ranSinceTick = new Set(running.values());
    if (isSuspended || late < STALL_MS) {
      return;
    }
    log.warn(
      `Main thread stalled for ${Math.round(late)}ms`,
      ran.size > 0 ? `during ${[...ran].join(", ")}` : "outside RPC",
    );
  }, TICK_MS);
  timer.unref();
}
