import { logger } from "@/electron-main/lib/electron-logger";
import {
  getPlatformApiReachability,
  probePlatformApiNow,
  type Reachability,
  startPlatformApiReachability,
} from "@/electron-main/platform-api/reachability";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  type NetworkStatus,
  NetworkStatusSchema,
} from "@/shared/network-status";
import { app, net, powerMonitor } from "electron";
import ms from "ms";

// `net.isOnline` can miss a dropped Wi-Fi network that still holds an
// address, and nothing announces one, so it is asked again on this timer too.
const ONLINE_CHECK_INTERVAL = ms("30 seconds");

/**
 * The one status the window's corner shows: offline wins, since a platform
 * API that does not answer from a computer with no connection says nothing
 * about the API; then a platform API known not to answer. A development
 * build's `override` stands in for both.
 */
export function combineNetworkStatus(inputs: {
  isOnline: boolean;
  override?: NetworkStatus;
  platformApi: Reachability;
}): NetworkStatus {
  if (inputs.override) {
    return inputs.override;
  }
  if (!inputs.isOnline) {
    return "offline";
  }
  return inputs.platformApi === "unreachable"
    ? "instrument-unreachable"
    : "online";
}

/**
 * `INSTRUMENT_NETWORK_STATUS`, read in development builds only, so scenarios
 * and screenshots can show each status without cutting the network.
 */
export function readNetworkStatusOverride(
  value: string | undefined,
  isPackaged: boolean,
): NetworkStatus | undefined {
  if (isPackaged || !value) {
    return undefined;
  }
  const parsed = NetworkStatusSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

let isOnline = true;
let status: NetworkStatus = "online";
let override: NetworkStatus | undefined;
let onBackOnline: (() => void) | undefined;

/**
 * Keeps the network status in main and tells every window when it changes.
 * `onBackOnline` runs whenever it turns `online` from either other status,
 * which is when the requests that failed for want of a connection or an
 * answer are worth making again.
 */
export function startNetworkStatus(options: { onBackOnline: () => void }) {
  onBackOnline = options.onBackOnline;
  override = readNetworkStatusOverride(
    process.env.INSTRUMENT_NETWORK_STATUS,
    app.isPackaged,
  );
  if (override) {
    logger.info(`Network status pinned to ${override} by the environment`);
  }
  isOnline = net.isOnline();
  startPlatformApiReachability({ onChange: recheckNetworkStatus });
  update();

  powerMonitor.on("resume", recheckNetworkStatus);
  powerMonitor.on("unlock-screen", recheckNetworkStatus);
  setInterval(recheckNetworkStatus, ONLINE_CHECK_INTERVAL).unref();
}

export function getNetworkStatus(): NetworkStatus {
  return status;
}

/**
 * Asks the OS again whether there is a connection, for any hint it changed:
 * the timer, a wake, a window's `online` or `offline` event, or a request
 * that could not connect.
 */
export function recheckNetworkStatus() {
  const wasOnline = isOnline;
  isOnline = net.isOnline();
  if (isOnline && !wasOnline) {
    probePlatformApiNow();
  }
  update();
}

function update() {
  const next = combineNetworkStatus({
    isOnline,
    override,
    platformApi: getPlatformApiReachability(),
  });
  if (next === status) {
    return;
  }
  const previous = status;
  status = next;
  logger.info(`Network status ${previous} -> ${next}`);
  publisher.publish("network.status.updated", null);
  if (next === "online") {
    onBackOnline?.();
  }
}
