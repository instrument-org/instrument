import { checkAppSignIns } from "@instrument-org/workspace/electron";
import { app, net } from "electron";

import { getAppsDir } from "./apps";
import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("AppSignIns");

/** How old the last look may be before the window coming forward asks again. */
const STALE_MS = 15 * 60 * 1000;

let checkedAt = 0;
let inFlight: Promise<void> | undefined;
let started = false;

/**
 * Asks each connected app whether its sign-in still holds: once the
 * workspace is up, and when a window comes forward after the last look went
 * stale. An app whose sign-in the service refuses is written down as
 * needing one, which is what Apps and the rail read; nothing here tells the
 * person itself. Skipped with no connection, since an app that cannot be
 * reached says nothing about its sign-in.
 */
export function startAppSignInChecks(): void {
  void checkNow();
  if (started) {
    return;
  }
  started = true;
  app.on("browser-window-focus", () => {
    if (Date.now() - checkedAt > STALE_MS) {
      void checkNow();
    }
  });
}

function checkNow(): Promise<void> {
  const appsDir = getAppsDir();
  if (appsDir === undefined || !net.isOnline()) {
    return Promise.resolve();
  }
  inFlight ??= (async () => {
    try {
      const lost = await checkAppSignIns({ appsDir });
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
