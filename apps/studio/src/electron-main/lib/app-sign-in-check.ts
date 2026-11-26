import {
  checkAppSignIns,
  publishAppSignIns,
} from "@instrument-org/workspace/electron";
import { app } from "electron";

import { appsReady } from "./apps";
import { createScopedLogger } from "./electron-logger";
import { getNetworkStatus } from "./network-status";

const log = createScopedLogger("AppSignIns");

/** How old the last look may be before the window coming forward asks again. */
const STALE_MS = 15 * 60 * 1000;

let checkedAt = 0;
let inFlight: Promise<void> | undefined;
let started = false;

/**
 * Publishes where each app stands on this computer, and asks each connected
 * app whether its sign-in still holds: once the
 * workspace is up, and when a window comes forward after the last look went
 * stale. An app whose sign-in the service refuses is written down as
 * needing one, which is what Apps and the rail read; nothing here tells the
 * person itself. Skipped with no connection, since an app that cannot be
 * reached says nothing about its sign-in.
 */
export function startAppSignInChecks(): void {
  publishNow();
  void checkNow();
  if (started) {
    return;
  }
  started = true;
  app.on("browser-window-focus", () => {
    if (Date.now() - checkedAt > STALE_MS) {
      publishNow();
      void checkNow();
    }
  });
}

/**
 * Where each app stands here, for the workspace's other computers to read:
 * written on every change, and here for what a build before this one
 * recorded and for the weekly write that shows this computer is in use.
 */
function publishNow(): void {
  void publishAppSignIns().catch((error: unknown) => {
    log.warn(new Error("Could not publish app sign-ins", { cause: error }));
  });
}

function checkNow(): Promise<void> {
  if (!appsReady() || getNetworkStatus() === "offline") {
    return Promise.resolve();
  }
  inFlight ??= (async () => {
    try {
      const lost = await checkAppSignIns();
      checkedAt = Date.now();
      if (lost.length > 0) {
        log.info(`Signed out of ${lost.join(", ")}`);
      }
    } catch (error) {
      log.warn(new Error("Could not check app sign-ins", { cause: error }));
    }
  })().finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}
