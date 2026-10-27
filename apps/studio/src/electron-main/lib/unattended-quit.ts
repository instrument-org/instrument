import { app, BrowserWindow, powerMonitor } from "electron";

import { logger } from "./electron-logger";
import { requestUnattendedQuit } from "./quit";
import { takeSignal } from "./take-signal";

/** What a logout, a shutdown, `systemctl stop`, a closed terminal or Ctrl+C sends. */
const QUIT_SIGNALS = ["SIGTERM", "SIGINT", "SIGHUP"] as const;

/**
 * Sends every quit no one asked for in the app to the quit machine as
 * unattended, so it skips the prompts nobody is there to answer and tears down
 * while the system still waits, then quits the way any other quit does.
 *
 * - A signal, on Linux and macOS. Electron's own handlers call `app.quit()`
 *   with nothing to say where the quit came from; `takeSignal` replaces them,
 *   which a plain `process.on` does not once a library has listened first.
 * - `powerMonitor`'s `shutdown`, on Linux (logind's `PrepareForShutdown`,
 *   which holds a delay lock until the process exits) and macOS (logout,
 *   restart and shutdown, which otherwise reach `before-quit` exactly as Cmd+Q
 *   does). Preventing it keeps Electron from starting a quit of its own.
 * - A window's `session-end`, on Windows. Windows ends the process soon after
 *   the handler returns, so the teardown there gets as far as it gets.
 *
 * Call once the app is ready: Electron installs its signal handlers as its
 * message loop starts, and replaces any installed before then.
 */
export function registerUnattendedQuit() {
  const quitUnattended = (source: string) => {
    logger.info(`Unattended quit: ${source}`);
    requestUnattendedQuit();
    // Before the workspace starts there is no quit machine to tell, and this
    // is an ordinary quit.
    app.quit();
  };

  if (process.platform === "win32") {
    const watch = (window: BrowserWindow) => {
      window.on("session-end", () => {
        quitUnattended("session-end");
      });
    };
    BrowserWindow.getAllWindows().forEach(watch);
    app.on("browser-window-created", (_, window) => {
      watch(window);
    });
    return;
  }

  for (const signal of QUIT_SIGNALS) {
    takeSignal(process, signal, () => {
      quitUnattended(signal);
    });
  }
  // Electron's types leave out the event it passes this listener.
  powerMonitor.on("shutdown", (event?: Electron.Event) => {
    event?.preventDefault();
    quitUnattended("shutdown");
  });
}
