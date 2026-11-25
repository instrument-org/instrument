import { logger } from "@/electron-main/lib/electron-logger";
import {
  askPlatformApi,
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
// It can also keep saying there is no connection after one came up (an app
// opened at login, before the network), so while it says that the platform
// API is asked on this timer as well.
const ONLINE_CHECK_INTERVAL = ms("30 seconds");

/**
 * The one status the window's corner shows. Offline takes the OS reporting no
 * connection and the platform API not known to answer: an answer is a
 * connection whatever the OS reports, and no answer from a computer the OS
 * calls offline says nothing about the API. Then a platform API known not to
 * answer. A development build's `override` stands in for both.
 */
export function combineNetworkStatus(inputs: {
  isOnline: boolean;
  override?: NetworkStatus;
  platformApi: Reachability;
}): NetworkStatus {
  if (inputs.override) {
    return inputs.override;
  }
  if (!inputs.isOnline && inputs.platformApi !== "reachable") {
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
let isOverruled = false;
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
  if (!isOnline) {
    askPlatformApi();
  }
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
  if (!isOnline) {
    askPlatformApi();
  }
  update();
}

function update() {
  const platformApi = getPlatformApiReachability();
  const wasOverruled = isOverruled;
  isOverruled = !isOnline && platformApi === "reachable";
  if (isOverruled && !wasOverruled) {
    logger.warn(
      "The system reports no connection while the platform API answers; counted as online",
    );
  }
  const next = combineNetworkStatus({ isOnline, override, platformApi });
  if (next === status) {
    return;
  }
  const previous = status;
  status = next;
  logger.info(
    `Network status ${previous} -> ${next} (system ${isOnline ? "online" : "offline"}, platform API ${platformApi})`,
  );
  publisher.publish("network.status.updated", null);
  if (next === "online") {
    onBackOnline?.();
  }
}
