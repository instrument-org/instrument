import { isExpectedNetworkError } from "@instrument-org/shared";
import { crashReporter } from "electron";
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
 * Both are reported through `captureServerException` like every other
 * exception, except the network drops `isExpectedNetworkError` recognizes. Those are a property of
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
 *
 * Two records cover what no JavaScript handler can see. Crashpad writes a
 * minidump for any process that dies natively, kept in `crashDumps` and never
 * uploaded; the next start logs each one it has not reported yet. A session
 * marker, written at start and removed on the way out, says the last session
 * ended some other way than exiting: a force-quit after a freeze, a native
 * crash in main, a power loss.
 */
export function registerCrashDiagnostics(app: Electron.App) {
  // Before ready, so every process the app starts is watched.
  crashReporter.start({ uploadToServer: false });

  reportPreviousCrash(app);
  reportUncleanExit(app);
  reportNewCrashDumps(app);

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
    logProcessGone(
      details,
      `render-process-gone ${identifyWebContents(webContents)} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });

  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") {
      return;
    }
    const name = details.name ?? details.serviceName ?? "unknown";
    logProcessGone(
      details,
      `child-process-gone type=${details.type} name=${name} reason=${details.reason} exitCode=${details.exitCode}`,
    );
  });
}

// SIGTERM is how a quit, and a dev relaunch, ends every child process, so a
// process killed by it is ordinary teardown rather than something that went
// wrong.
const SIGTERM_EXIT_CODE = 15;

function logProcessGone(
  details: { exitCode: number; reason: string },
  line: string,
) {
  if (details.reason === "killed" && details.exitCode === SIGTERM_EXIT_CODE) {
    log.info(line);
    return;
  }
  log.error(line);
}

function getSessionMarkerPath(app: Electron.App) {
  return path.join(app.getPath("userData"), "app.lock");
}

function getDumpsReportedPath(app: Electron.App) {
  return path.join(app.getPath("userData"), "crash-dumps-reported");
}

/** Whether `pid` is a process still running, other than this one. */
function isOtherLiveProcess(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  if (pid === process.pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Say so when the last session never got to exit, then mark this one.
 *
 * The marker is removed on Node's `exit`, which every orderly ending reaches,
 * the quit teardown's `app.exit` included. A marker still there at the next
 * start is a session that ended without it. A marker held by a live process
 * belongs to another instance sharing this data folder (development runs one
 * per worktree), so it is neither reported nor taken over. A marker with no
 * readable details is one an older build wrote, and it still means the same.
 */
function reportUncleanExit(app: Electron.App) {
  const markerPath = getSessionMarkerPath(app);
  try {
    if (fs.existsSync(markerPath)) {
      const previous = readSessionMarker(markerPath);
      if (isOtherLiveProcess(previous?.pid)) {
        return;
      }
      if (previous?.pid !== process.pid) {
        const details = previous
          ? ` (${previous.version}, started ${previous.startedAt})`
          : "";
        log.warn(
          `Previous session${details} did not exit cleanly: it was force-quit, stopped responding, or crashed.`,
        );
      }
    }
    fs.writeFileSync(
      markerPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        version: app.getVersion(),
      }),
    );
  } catch (error) {
    log.warn(
      new Error("Could not check the previous session's exit", {
        cause: error,
      }),
    );
    return;
  }
  process.on("exit", () => {
    try {
      if (readSessionMarker(markerPath)?.pid === process.pid) {
        fs.rmSync(markerPath, { force: true });
      }
    } catch {
      // Already gone, or another instance has it.
    }
  });
}

function readSessionMarker(
  markerPath: string,
): { pid: number; startedAt: string; version: string } | undefined {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(markerPath, "utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "pid" in parsed &&
      "startedAt" in parsed &&
      "version" in parsed &&
      typeof parsed.pid === "number" &&
      typeof parsed.startedAt === "string" &&
      typeof parsed.version === "string"
    ) {
      return {
        pid: parsed.pid,
        startedAt: parsed.startedAt,
        version: parsed.version,
      };
    }
  } catch {
    // Unreadable, or written by a build that kept no details.
  }
  return undefined;
}

/**
 * Log each Crashpad minidump written since the last start reported any.
 *
 * Crashpad keeps its own database under `crashDumps` and prunes it by age and
 * size, so this only reads. The dumps stay on this computer; the log line says
 * where one is, for a report the user chooses to send.
 */
function reportNewCrashDumps(app: Electron.App) {
  const reportedPath = getDumpsReportedPath(app);
  try {
    const reportedUntil = fs.existsSync(reportedPath)
      ? Number(fs.readFileSync(reportedPath, "utf8").trim()) || 0
      : 0;
    const dumps = fs
      .readdirSync(app.getPath("crashDumps"), {
        recursive: true,
        withFileTypes: true,
      })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".dmp"))
      .map((entry) => {
        const dumpPath = path.join(entry.parentPath, entry.name);
        return { dumpPath, mtimeMs: fs.statSync(dumpPath).mtimeMs };
      })
      .filter(({ mtimeMs }) => mtimeMs > reportedUntil)
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const { dumpPath, mtimeMs } of dumps) {
      log.error(
        `A process crashed at ${new Date(mtimeMs).toISOString()}; its minidump is ${dumpPath}`,
      );
    }
    const latest = dumps.at(-1);
    if (latest) {
      fs.writeFileSync(reportedPath, String(latest.mtimeMs));
    }
  } catch (error) {
    // No `crashDumps` yet is the first start, not a failure.
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    log.warn(new Error("Could not read the crash dumps", { cause: error }));
  }
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
