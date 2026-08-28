import fs from "node:fs";
import path from "node:path";

import { isDeveloperMode } from "../stores/preferences";
import { describeError } from "./describe-error";
import { createScopedLogger } from "./electron-logger";
import { addServerException } from "./server-exceptions";

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
 * None of this is recovery, and it is careful not to become recovery by
 * accident. An `uncaughtException` listener does not merely observe a throw, it
 * replaces what Node does about one: attach it and the process stops dying.
 * `uncaughtExceptionMonitor` is the half that only watches, so a main-process
 * throw still ends the process exactly as it would have, and Node still prints
 * the stack itself.
 *
 * An unhandled rejection is the one exception, and deliberately. A promise
 * nobody awaited is routine in an app this size -- an aborted fetch, a
 * cancelled query, an actor torn down mid-flight -- and Node's default is to
 * promote it to an uncaught exception and take the window down with whatever
 * was in it. That one is worth catching rather than dying of.
 *
 * Each record is deliberately content-free -- a process type, a reason, an exit
 * code -- so it can be read, exported, or attached to a report the user chooses
 * to send with nothing to redact first.
 */
export function registerCrashDiagnostics(app: Electron.App) {
  reportPreviousCrash(app);

  // Observational: the process still dies, which is why the record cannot go
  // through the logger. See `writeCrashRecord`.
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    // The stack where there is one, since this record is all anyone gets.
    const { details, message } = describeError(error);
    writeCrashRecord(app, `${origin}: ${details ?? message}`);
  });

  // Suppressing, and the only handler here that is. The app is still alive
  // afterwards, so this record drains through the logger like any other.
  process.on("unhandledRejection", (error) => {
    log.error(error);
    if (isDeveloperMode()) {
      addServerException(describeError(error));
    }
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
      log.error(
        `Previous session ended in an uncaught exception:\n${contents}`,
      );
    }
  } catch (error) {
    log.warn(
      new Error("Could not read the previous crash record", { cause: error }),
    );
  }
}

/**
 * Put a dying process's last words somewhere they will still be there.
 *
 * Written with a synchronous append rather than through the logger, which is
 * the whole reason this file exists. `electron-log`'s file transport is in
 * async mode here: it queues a line and drains it through `fs.writeFile`, with
 * no flush API and no drain on exit, so a line handed to it by a handler that
 * is about to let the process die is a line nobody ever reads. Every other
 * record in this module is written by a handler the app survives, which is what
 * makes the queue safe for those and not for this one.
 *
 * The next start reads it back into the log, so the record still reaches the
 * one file a user can export. In development the file transport is off
 * entirely and Node's own stderr already carries the stack, so this is for the
 * packaged build, where it is the only account there is.
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
