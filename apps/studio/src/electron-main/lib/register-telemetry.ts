import fs from "node:fs/promises";
import path from "node:path";
import { noop } from "radashi";
import { z } from "zod";

import { getPreferencesStore } from "../stores/preferences";
import { captureServerEvent } from "./capture-server-event";
import { logger } from "./electron-logger";
import { telemetry } from "./telemetry";

const CaptureSchema = z.looseObject({
  event: z.string(),
});

let quitTeardown: (() => Promise<void>) | null = null;
let pendingTeardown: null | Promise<void> = null;

/**
 * Record the quit and clear the marker that says the last session died. The
 * app's own shutdown path ends in `app.exit`, which by design never emits
 * `will-quit`, so it has to call this itself; the `will-quit` fallback below
 * covers a failed boot before that path exists. Idempotent, and never rejects
 * -- telemetry must not be able to hold up a quit.
 */
export function finalizeTelemetry(): Promise<void> {
  pendingTeardown ??= quitTeardown?.().catch(noop) ?? Promise.resolve();
  return pendingTeardown;
}

export function registerTelemetry(app: Electron.App) {
  const lockFilename = path.join(app.getPath("userData"), "app.lock");
  void app.whenReady().then(async () => {
    let gracefulExit = true;
    try {
      await fs.access(lockFilename);
      logger.warn("Detected non-graceful exit from previous session.");
      gracefulExit = false;
      await fs.unlink(lockFilename);
    } catch {
      // No lock file means graceful exit or first run
    }

    // The marker is best-effort: a failed write must not become an unhandled
    // rejection that also swallows the `app.ready` event below.
    await fs.writeFile(lockFilename, "running").catch((error: unknown) => {
      logger.warn("Failed to write the session lock file.", error);
    });
    captureServerEvent("app.ready", { graceful_exit: gracefulExit });
  });

  quitTeardown = async () => {
    // Unlink first: the marker is what a later boot reads to decide the last
    // session crashed, so it must not depend on the network flush that follows.
    await fs.unlink(lockFilename).catch(noop);
    captureServerEvent("app.quit");
    await telemetry?.flush();
    await telemetry?.shutdown();
  };

  app.on("will-quit", (event) => {
    if (pendingTeardown) {
      return;
    }
    event.preventDefault();
    logger.info("Quit teardown started from will-quit");

    // Bounded so a stuck flush can't wedge the quit.
    const forceQuit = setTimeout(() => {
      app.quit();
    }, 3000);
    void finalizeTelemetry().finally(() => {
      clearTimeout(forceQuit);
      app.quit();
    });
  });

  const preferencesStore = getPreferencesStore();
  const initialOptIn = preferencesStore.get("enableUsageMetrics");
  if (typeof initialOptIn === "boolean") {
    void updateOptInState(initialOptIn);
  }

  preferencesStore.onDidChange("enableUsageMetrics", (enableUsageMetrics) => {
    if (typeof enableUsageMetrics === "boolean") {
      void updateOptInState(enableUsageMetrics);
    }
  });

  telemetry?.on("capture", (payload) => {
    const parsed = CaptureSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    const { event } = parsed.data;
    if (event === "$exception") {
      // eslint-disable-next-line no-console
      console.groupCollapsed("[Telemetry] Exception captured");
      logger.error(JSON.stringify(payload, null, 2));
      // eslint-disable-next-line no-console
      console.groupEnd();
    }
  });
}

async function updateOptInState(isOptedIn: boolean) {
  await (isOptedIn ? telemetry?.optIn() : telemetry?.optOut());
}
