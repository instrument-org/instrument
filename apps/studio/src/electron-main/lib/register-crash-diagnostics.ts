import { isExpectedNetworkError } from "@instrument-org/shared";
import fs from "node:fs";
import path from "node:path";

import { captureServerException } from "./capture-server-exception";
import { describeError } from "./describe-error";
import { createScopedLogger } from "./electron-logger";

const log = createScopedLogger("CrashDiagnostics");

// Bounded on the way back in, because what it holds is a stack trace of no
// contracted size.
const MAX_CRASH_RECORD_BYTES = 8000;

// Latched while the record below is being written, because writing it can
// itself throw and Node would promote that into another uncaught exception,
// re-entering the handler that is mid-write.
let isWritingCrashRecord = false;

/**
 * Write down the ways a process can die, from the one process still running.
 *
 * A renderer or a child process that dies takes its stack with it, and a
 * native crash is over before any of its own JavaScript could react. The main
 * process is the only place left to record that it happened, and the log file
 * is the only record that outlives the session.
 *
 * A throw in the main process does not end it. Electron installs an
 * `uncaughtException` listener of its own that never exits: when it is the only
 * listener it shows a "JavaScript error occurred in the main process" dialog,
 * and when any other listener is attached it does nothing. The listener here is
 * that other listener, so a main-process throw is reported and the app carries
 * on without a dialog. It must not throw itself: Node ends the process outright
 * when an `uncaughtException` listener does.
 *
 * An unhandled rejection is answered the same way. A promise nobody awaited is
 * routine in an app this size -- an aborted fetch, a cancelled query, an actor
 * torn down mid-flight -- and Node's default is to promote it to an uncaught
 * exception.
 *
 * Both are reported through `captureServerException`, so they carry the app
 * version and the install's telemetry id like every other report, except the
 * network drops `isExpectedNetworkError` recognizes. Those are a property of
 * the user's connection: a dependency that downloads without an error listener
 * turns a network change into an uncaught throw, and nothing about it is a bug
 * here.
 *
 * The two process-gone records are content-free -- a process type, a name, a
 * reason, an exit code -- so either can be read, exported, or attached to a
 * report the user chooses to send with nothing to redact first. The
 * uncaught-exception and unhandled-rejection records are not: they carry the
 * throw's message and stack, and a message is whatever the throw put in it. A
 * rejected task-file read names a host path and a task directory whose name
 * came from the user's own prompt.
 */
export function registerCrashDiagnostics(app: Electron.App) {
  reportPreviousCrash(app);

  // Written synchronously, ahead of the listeners below, so the record exists
  // whatever reporting does. See `writeCrashRecord`. A network drop is left
  // out, since the listener below already logs it and it is not a bug.
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    if (isExpectedNetworkError(error)) {
      return;
    }
    // The stack where there is one, since this record is all anyone gets.
    const { details, message } = describeError(error);
    writeCrashRecord(app, `${origin}: ${details ?? message}`);
  });

  process.on("uncaughtException", (error) => {
    reportProcessError(error, "uncaughtException");
  });

  process.on("unhandledRejection", (error) => {
    reportProcessError(error, "unhandledRejection");
  });

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

function getCrashRecordPath(app: Electron.App) {
  return path.join(app.getPath("userData"), "last-crash.log");
}

function identifyWebContents(webContents: Electron.WebContents): string {
  // A `webContents` outlives its render process, but not dependably long
  // enough to answer for itself.
  if (webContents.isDestroyed()) {
    return "type=destroyed";
  }
  return `type=${webContents.getType()} id=${webContents.id}`;
}

/**
 * Fold the previous session's dying words into this session's log.
 *
 * Removed once read, so a later boot does not report the same crash again.
 */
function reportPreviousCrash(app: Electron.App) {
  const recordPath = getCrashRecordPath(app);
  try {
    if (!fs.existsSync(recordPath)) {
      return;
    }
    const contents = fs
      .readFileSync(recordPath, "utf8")
      .trim()
      .slice(-MAX_CRASH_RECORD_BYTES);
    fs.rmSync(recordPath, { force: true });
    if (contents) {
      log.error(`Previous session hit an uncaught exception:\n${contents}`);
    }
  } catch (error) {
    log.warn(
      new Error("Could not read the previous crash record", { cause: error }),
    );
  }
}

function reportProcessError(
  error: unknown,
  origin: "uncaughtException" | "unhandledRejection",
) {
  try {
    if (isExpectedNetworkError(error)) {
      log.warn(`${origin} from a network failure`, error);
      return;
    }
    captureServerException(error, { origin, scopes: ["studio"] });
  } catch {
    // A throw from an `uncaughtException` listener ends the process, which is
    // worse than losing one report.
  }
}

/**
 * Put an uncaught throw's stack somewhere it will still be there.
 *
 * Written with a synchronous append rather than through the logger.
 * `electron-log`'s file transport is in async mode here: it queues a line and
 * drains it through `fs.writeFile`, with no flush API and no drain on exit, so
 * a line queued just before the process ends is a line nobody ever reads. A
 * main-process throw leaves the app running, but it is the throw most likely
 * to be followed by a quit or a force-quit, and this record has to outlive
 * either.
 *
 * The next start reads it back into the log, so the record still reaches the
 * one file a user can export. In development the file transport is off
 * entirely, so this is for the packaged build.
 */
function writeCrashRecord(app: Electron.App, record: string) {
  // VS Code's own crash diagnostics carry the same latch, after a CI run
  // looped into a 386 MB log without one.
  if (isWritingCrashRecord) {
    return;
  }
  isWritingCrashRecord = true;
  try {
    fs.appendFileSync(
      getCrashRecordPath(app),
      `${new Date().toISOString()} ${record}\n`,
    );
  } catch {
    // The process is ending either way, and there is nowhere left to say so.
  } finally {
    isWritingCrashRecord = false;
  }
}
