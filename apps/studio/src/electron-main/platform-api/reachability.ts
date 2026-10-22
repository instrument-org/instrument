import { platformApiBaseUrl } from "@/electron-main/platform-api/base-url";
import { logger } from "@/electron-main/lib/electron-logger";
import { isExpectedNetworkError } from "@instrument-org/shared";
import { app } from "electron";
import ms from "ms";

export type Reachability = "reachable" | "unknown" | "unreachable";

const PROBE_TIMEOUT = ms("3 seconds");
const FIRST_PROBE_DELAY = ms("5 seconds");
const LONGEST_PROBE_DELAY = ms("1 minute");

/**
 * How long to wait before asking a platform API that has not answered
 * `failedProbes` times in a row. A development build asks a local server
 * every 5 seconds, since that is how soon a developer who starts it expects
 * the window to notice; a packaged one doubles from 5 seconds up to a minute,
 * so a long outage costs a request a minute per computer.
 */
export function probeDelay(failedProbes: number, isPackaged: boolean) {
  if (!isPackaged) {
    return FIRST_PROBE_DELAY;
  }
  return Math.min(
    FIRST_PROBE_DELAY * 2 ** Math.max(0, failedProbes - 1),
    LONGEST_PROBE_DELAY,
  );
}

let reachability: Reachability = "unknown";
let probeTimer: NodeJS.Timeout | undefined;
let failedProbes = 0;
let onChange: ((reachability: Reachability) => void) | undefined;

/**
 * Whether the platform API answers. Requests to it report what they learned
 * (`notePlatformApiAnswered`, `notePlatformApiFailed`), and once one finds nothing listening a probe
 * keeps asking, backing off, until it answers. Any HTTP response counts as
 * an answer: the question is whether something is listening, not whether it
 * is healthy. A development build also asks once at launch, so the first
 * requests to a local API server that is not running already find it down.
 */
export function startPlatformApiReachability(options: {
  onChange: (reachability: Reachability) => void;
}) {
  onChange = options.onChange;
  if (!app.isPackaged) {
    void probe();
  }
}

export function getPlatformApiReachability(): Reachability {
  return reachability;
}

export function isPlatformApiUnreachable() {
  return reachability === "unreachable";
}

/**
 * A request to the platform API got an answer, whatever its status. Callers
 * say so rather than hand over the response to be recognized: the workspace
 * server puts @hono/node-server's `Response` on the global, and what `fetch`
 * resolves to in this process is not an instance of it.
 */
export function notePlatformApiAnswered() {
  setReachability("reachable");
}

/** A request to the platform API failed without an answer. */
export function notePlatformApiFailed(error: unknown) {
  if (isExpectedNetworkError(error)) {
    setReachability("unreachable");
  }
}

/**
 * Asks again now, starting the backoff over, for when something suggests the
 * answer may have changed (the computer came back online). Only while the API
 * is known not to answer, since otherwise the next request finds out anyway.
 */
export function probePlatformApiNow() {
  if (reachability !== "unreachable") {
    return;
  }
  clearTimeout(probeTimer);
  probeTimer = undefined;
  failedProbes = 0;
  void probe();
}

async function probe() {
  probeTimer = undefined;
  try {
    await fetch(platformApiBaseUrl(), {
      method: "HEAD",
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });
    notePlatformApiAnswered();
  } catch (error) {
    notePlatformApiFailed(error);
  }
  if (reachability === "unreachable") {
    failedProbes += 1;
    scheduleProbe();
  }
}

function scheduleProbe() {
  if (probeTimer) {
    return;
  }
  probeTimer = setTimeout(
    () => void probe(),
    probeDelay(failedProbes, app.isPackaged),
  );
}

function setReachability(next: Reachability) {
  if (next === reachability) {
    return;
  }
  const previous = reachability;
  reachability = next;

  const baseUrl = platformApiBaseUrl();
  if (next === "unreachable") {
    logger.warn(
      app.isPackaged
        ? `Platform API not reachable at ${baseUrl}; its connection errors go uncaptured until it answers.`
        : `Platform API not reachable at ${baseUrl}; is the API server running? Its connection errors go uncaptured until it answers.`,
    );
    failedProbes = 0;
    scheduleProbe();
  } else {
    clearTimeout(probeTimer);
    probeTimer = undefined;
    failedProbes = 0;
    if (previous === "unreachable") {
      logger.info(`Platform API reachable again at ${baseUrl}`);
    }
  }
  onChange?.(next);
}
