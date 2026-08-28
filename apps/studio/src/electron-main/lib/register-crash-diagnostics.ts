import { isDeveloperMode } from "../stores/preferences";
import { describeError } from "./describe-error";
import { createScopedLogger } from "./electron-logger";
import { addServerException } from "./server-exceptions";

const log = createScopedLogger("CrashDiagnostics");

/**
 * Write down the ways a process can die, from the one process still running.
 *
 * A renderer or a child process that dies takes its stack with it, and a
 * native crash is over before any of its own JavaScript could react. The main
 * process is the only place left to record that it happened, and the log file
 * is the only record that outlives the session.
 *
 * None of this is recovery. The browser-view pool already tears down a dead
 * guest and Chromium replaces a dead GPU process; what neither leaves behind
 * is a line saying so. Each record is deliberately content-free -- a process
 * type, a reason, an exit code -- so it can be read, exported, or attached to
 * a report the user chooses to send with nothing to redact first.
 */
export function registerCrashDiagnostics(app: Electron.App) {
  // Node suppresses its own exit while any listener is attached, so an
  // uncaught throw in main leaves the app running with this record written
  // rather than taking down a window that may hold unsaved work.
  process.on("uncaughtException", handleProcessError);
  process.on("unhandledRejection", handleProcessError);

  app.on("render-process-gone", (_event, webContents, details) => {
    if (details.reason === "clean-exit") {
      return;
    }
    log.error(
      `render-process-gone ${identifyWebContents(webContents)} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });

  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") {
      return;
    }
    const name = details.name ?? details.serviceName ?? "unknown";
    log.error(
      `child-process-gone type=${details.type} name=${name} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
}

function handleProcessError(error: unknown) {
  log.error(error);

  if (isDeveloperMode()) {
    addServerException(describeError(error));
  }
}

/**
 * Which renderer died, without saying what it was showing. The type separates
 * one of our own windows from a page the user opened in a task's browser, and
 * that is all a crash record needs; the URL is the user's business.
 */
function identifyWebContents(webContents: Electron.WebContents): string {
  // A `webContents` outlives its render process, but not dependably long
  // enough to answer for itself.
  if (webContents.isDestroyed()) {
    return "type=destroyed";
  }
  return `type=${webContents.getType()} id=${webContents.id}`;
}
