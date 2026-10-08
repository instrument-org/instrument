import { logger } from "@/electron-main/lib/electron-logger";
import { publisher } from "@/electron-main/rpc/publisher";
import { isExpectedNetworkError } from "@instrument-org/shared";
import { app } from "electron";
import ms from "ms";

type Reachability = "reachable" | "unknown" | "unreachable";

const PROBE_INTERVAL = ms("5 seconds");
const PROBE_TIMEOUT = ms("3 seconds");

let reachability: Reachability = "unknown";
let probeTimer: NodeJS.Timeout | undefined;
let onReachableAgain: (() => void) | undefined;

/**
 * Whether the platform API answers, for a development build pointed at an API
 * server that may not be running. While it does not, the corner of the window
 * says so, failed requests to it skip exception capture, and a probe keeps
 * asking until it answers, at which point the queries that failed run again.
 * Any HTTP response counts as an answer: the question is whether something is
 * listening, not whether it is healthy. A packaged build never asks, so it
 * stays "unknown" there and nothing changes.
 */
export function startPlatformApiReachability(options: {
  onReachableAgain: () => void;
}) {
  if (app.isPackaged) {
    return;
  }
  onReachableAgain = options.onReachableAgain;
  void probe();
}

export function getPlatformApiReachability(): {
  baseUrl: string;
  status: Reachability;
} {
  return {
    baseUrl: import.meta.env.MAIN_VITE_APP_API_BASE_URL,
    status: reachability,
  };
}

export function isPlatformApiUnreachable() {
  return reachability === "unreachable";
}

/** What a request to the platform API learned about whether it answers. */
export function notePlatformApiOutcome(outcome: unknown) {
  if (app.isPackaged) {
    return;
  }
  if (outcome instanceof Response) {
    setReachability("reachable");
  } else if (isExpectedNetworkError(outcome)) {
    setReachability("unreachable");
  }
}

async function probe() {
  probeTimer = undefined;
  try {
    const response = await fetch(import.meta.env.MAIN_VITE_APP_API_BASE_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(PROBE_TIMEOUT),
    });
    notePlatformApiOutcome(response);
  } catch (error) {
    notePlatformApiOutcome(error);
  }
  if (reachability === "unreachable" && !probeTimer) {
    probeTimer = setTimeout(() => void probe(), PROBE_INTERVAL);
  }
}

function setReachability(next: Reachability) {
  if (next === reachability) {
    return;
  }
  const previous = reachability;
  reachability = next;
  publisher.publish("platform-api.reachability.updated", null);

  const baseUrl = import.meta.env.MAIN_VITE_APP_API_BASE_URL;
  if (next === "unreachable") {
    logger.warn(
      `Platform API not reachable at ${baseUrl}; is the API server running? Its connection errors go uncaptured until it answers.`,
    );
    if (!probeTimer) {
      probeTimer = setTimeout(() => void probe(), PROBE_INTERVAL);
    }
    return;
  }
  if (previous === "unreachable") {
    logger.info(`Platform API reachable again at ${baseUrl}`);
    onReachableAgain?.();
  }
}
