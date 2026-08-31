import { captureServerException } from "./capture-server-exception";
import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("WindowLoad");

// Chromium's code for a load superseded by another navigation, which is
// routine rather than a failure.
const ERR_ABORTED = -3;

/**
 * Load a top-level window's URL with the failure paths on the record.
 *
 * A discarded `loadURL` promise is invisible even to the process-level
 * unhandledRejection handler: Electron attaches its own no-op rejection
 * handler to the promise, so an explicit `.catch` is the only way to hear
 * about a renderer that never loaded. `did-fail-load` covers the loads after
 * the first, e.g. an in-app reload.
 */
export function loadWindowURL(
  webContents: Electron.WebContents,
  url: string,
): void {
  webContents.on(
    "did-fail-load",
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) {
        return;
      }
      log.error(
        `did-fail-load ${validatedURL}: ${errorDescription} (${errorCode})`,
      );
    },
  );

  webContents.loadURL(url).catch((error: unknown) => {
    // The rejection carries Chromium's error name in `code`.
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ERR_ABORTED"
    ) {
      return;
    }
    captureServerException(
      new Error(`Renderer failed to load ${url}`, { cause: error }),
    );
  });
}
