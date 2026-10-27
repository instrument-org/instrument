import { isExpectedNetworkError } from "@instrument-org/shared";
import {
  type ExceptionEvent,
  ExceptionEventSchema,
  formatExceptionEvent,
} from "@instrument-org/shared/exceptions";
import { crashReporter } from "electron";
import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";

import {
  buildMainExceptionEvent,
  recordExceptionEvent,
} from "./capture-server-exception";
import { createScopedLogger, stopConsoleLogging } from "./electron-logger";
import { storeExceptionEvent } from "./exception-store";
import { recordEndedSession } from "./problem-reports";
import { createRepeatLimiter } from "./repeat-limiter";

const log = createScopedLogger("CrashDiagnostics");

// Bounded on the way back in: an event's data has no contracted size.
const MAX_CRASH_RECORD_BYTES = 2_000_000;

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
 * Both are captured as unhandled exception events like every other
 * exception, except the network drops `isExpectedNetworkError` recognizes.
 * Those are a property of the user's connection: a dependency that downloads
 * without an error listener turns a network change into an uncaught throw,
 * and nothing about it is a bug here. A renderer or child process that ends
 * abnormally is an event too, at level `fatal` with the `process-gone`
 * mechanism, carrying its type, name, reason and exit code.
 *
 * Two records cover what no JavaScript handler can see. Crashpad writes a
 * minidump for any process that dies natively, kept in `crashDumps` and never
 * uploaded; the next start logs each one it has not reported yet. A session
 * marker, written at start and removed on the way out, says the last session
 * ended some other way than exiting: a force-quit after a freeze, a native
 * crash in main, a power loss.
 *
 * Reporting an error must never cause the next one. Logging it can fail (a
 * full disk, a closed terminal), and that failure arrives later as an error
 * of its own, so a handler that reports whatever it is handed reports its own
 * fallout forever. Three things stop that. An error raised by anything
 * reporting started, however much later, is counted once and dropped: the
 * reporting runs in an async context its continuations inherit. A failed
 * write to the terminal or the disk is the environment rather than a bug: it
 * is said once, and a broken terminal turns console logging off. And each
 * problem, by fingerprint, is recorded a few times a minute at most, with
 * every problem together capped, the next recorded event counting the ones
 * held back.
 */
export function registerCrashDiagnostics(app: Electron.App) {
  // Before ready, so every process the app starts is watched.
  crashReporter.start({ uploadToServer: false });

  const crashRecord = reportPreviousCrash(app);
  const exit = reportUncleanExit(app);
  const dumps = reportNewCrashDumps(app);
  const endedAt = Date.now();
  // Once ready, because the report is redacted with the accounts signed in,
  // and the stores naming them can only be decrypted then.
  void app
    .whenReady()
    .then(() => {
      recordEndedSession({
        crashRecord,
        dumps,
        endedAt,
        previousVersion: exit.previousVersion,
        unclean: exit.unclean,
      });
    })
    .catch((error: unknown) => {
      log.error("Could not record how the last session ended", error);
    });

  const gate = createFaultGate();
  // The event the monitor built for the throw the listener is about to get,
  // none when the gate held it back.
  let monitored:
    | { error: unknown; event: ExceptionEvent | undefined }
    | undefined;

  // Written synchronously, ahead of the listeners below, so the record exists
  // whatever reporting does. See `writeCrashRecord`. A network drop is left
  // out, since the listener below already logs it and it is not a bug. The
  // event is the one the listener then records, so the crash record and the
  // exception store hold the same event under one id.
  process.on("uncaughtExceptionMonitor", (error, origin) => {
    gate.handle(error, () => {
      if (isExpectedNetworkError(error)) {
        return;
      }
      monitored = { error, event: undefined };
      const event = gate.admit(
        buildMainExceptionEvent(error, { handled: false, mechanism: origin }),
      );
      monitored.event = event;
      if (event) {
        writeCrashRecord(app, event);
      }
    });
  });

  process.on("uncaughtException", (error) => {
    const seen = monitored?.error === error ? monitored : undefined;
    monitored = undefined;
    gate.handle(error, () => {
      if (seen) {
        if (seen.event) {
          recordExceptionEvent(seen.event);
        }
        return;
      }
      reportProcessError(error, "uncaughtException", gate);
    });
  });

  process.on("unhandledRejection", (error) => {
    gate.handle(error, () => {
      reportProcessError(error, "unhandledRejection", gate);
    });
  });

  app.on("render-process-gone", (_event, webContents, details) => {
    if (details.reason === "clean-exit") {
      return;
    }
    logProcessGone(
      gate,
      details,
      `render-process-gone ${identifyWebContents(webContents)} reason=${details.reason} exitCode=${details.exitCode}`,
      {
        data: {
          exitCode: details.exitCode,
          reason: details.reason,
          webContents: identifyWebContents(webContents),
        },
        type: "RenderProcessGone",
        value: `A renderer ended: ${details.reason}`,
      },
    );
  });

  app.on("child-process-gone", (_event, details) => {
    if (details.reason === "clean-exit") {
      return;
    }
    const name = details.name ?? details.serviceName ?? "unknown";
    logProcessGone(
      gate,
      details,
      `child-process-gone type=${details.type} name=${name} reason=${details.reason} exitCode=${details.exitCode}`,
      {
        data: {
          exitCode: details.exitCode,
          name,
          reason: details.reason,
          type: details.type,
        },
        type: "ChildProcessGone",
        value: `The ${name} ${details.type} process ended: ${details.reason}`,
      },
    );
  });
}

/** How long the limits below count over. */
const FAULT_INTERVAL_MS = 60_000;

/** How often one problem, by fingerprint, is recorded per interval. */
const RECORDS_PER_FAULT = 5;

/** How many records of any problem are made per interval. */
const RECORDS_PER_INTERVAL = 30;

// A failed write to a stream: stdout or stderr gone (EPIPE), a terminal that
// closed under a running process (EIO), a descriptor no longer open (EBADF),
// a full disk (ENOSPC).
const WRITE_FAILURE_CODES = new Set(["EBADF", "EIO", "ENOSPC", "EPIPE"]);
const BROKEN_STREAM_CODES = new Set(["EBADF", "EIO", "EPIPE"]);

function writeFailureCode(error: unknown): string | undefined {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "syscall" in error &&
    error.syscall === "write" &&
    typeof error.code === "string" &&
    WRITE_FAILURE_CODES.has(error.code)
  ) {
    return error.code;
  }
  return undefined;
}

type FaultGate = ReturnType<typeof createFaultGate>;

/**
 * What stands between an error and its report: the reentrancy guard, the
 * write-failure check, and the repeat limits. One per registration.
 */
function createFaultGate() {
  // Set for the whole of a report, and inherited by every timer, tick and
  // promise the report starts, so an error any of them raises is known to
  // come from reporting. Node delivers an uncaught throw and a rejection in
  // the async context of the code that raised it.
  const reporting = new AsyncLocalStorage<true>();
  const sameFault = createRepeatLimiter({
    intervalMs: FAULT_INTERVAL_MS,
    limit: RECORDS_PER_FAULT,
  });
  const anyFault = createRepeatLimiter({
    intervalMs: FAULT_INTERVAL_MS,
    limit: RECORDS_PER_INTERVAL,
  });
  let raisedWhileReporting = 0;
  let writeFailures = 0;

  /** Run `report` for `error`, unless reporting or the environment raised it. */
  const handle = (error: unknown, report: () => void) => {
    try {
      if (reporting.getStore()) {
        raisedWhileReporting += 1;
        if (raisedWhileReporting === 1) {
          reporting.run(true, () => {
            log.warn(
              "Reporting an error raised another; it and any more like it are left out",
              error,
            );
          });
        }
        return;
      }
      const code = writeFailureCode(error);
      if (code) {
        if (BROKEN_STREAM_CODES.has(code)) {
          stopConsoleLogging();
        }
        writeFailures += 1;
        if (writeFailures === 1) {
          reporting.run(true, () => {
            log.warn(`A write failed with ${code}; later ones are left out`);
          });
        }
        return;
      }
      reporting.run(true, report);
    } catch {
      // An `uncaughtException` listener that throws ends the process, which
      // is worse than losing one report.
    }
  };

  /**
   * The event to record, or none when its problem has been recorded enough
   * for now. The first one through after a quiet spell counts the ones held
   * back.
   */
  const admit = (event: ExceptionEvent): ExceptionEvent | undefined => {
    const now = Date.now();
    const same = sameFault(event.fingerprint, now);
    if (!same.allowed) {
      return undefined;
    }
    const any = anyFault("", now);
    if (!any.allowed) {
      return undefined;
    }
    return same.suppressed > 0
      ? { ...event, count: event.count + same.suppressed }
      : event;
  };

  return { admit, handle };
}

// SIGTERM is how a quit, and a dev relaunch, ends every child process, so a
// process killed by it is ordinary teardown rather than something that went
// wrong.
const SIGTERM_EXIT_CODE = 15;

function logProcessGone(
  gate: FaultGate,
  details: { exitCode: number; reason: string },
  line: string,
  gone: { data: Record<string, unknown>; type: string; value: string },
) {
  if (details.reason === "killed" && details.exitCode === SIGTERM_EXIT_CODE) {
    log.info(line);
    return;
  }
  // No stack to show: the process took its own with it. The error is made
  // here only to carry the type and the words, so its stack is dropped.
  const error = Object.assign(new Error(gone.value), { name: gone.type });
  error.stack = `${gone.type}: ${gone.value}`;
  gate.handle(error, () => {
    const event = gate.admit(
      buildMainExceptionEvent(error, {
        data: gone.data,
        handled: false,
        level: "fatal",
        mechanism: "process-gone",
      }),
    );
    if (event) {
      log.error(line);
      recordExceptionEvent(event);
    }
  });
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
function reportUncleanExit(app: Electron.App): {
  previousVersion: string | undefined;
  unclean: boolean;
} {
  const markerPath = getSessionMarkerPath(app);
  let previousVersion: string | undefined;
  let unclean = false;
  try {
    if (fs.existsSync(markerPath)) {
      const previous = readSessionMarker(markerPath);
      if (isOtherLiveProcess(previous?.pid)) {
        return { previousVersion: undefined, unclean: false };
      }
      if (previous?.pid !== process.pid) {
        unclean = true;
        previousVersion = previous?.version;
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
    return { previousVersion, unclean };
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
  return { previousVersion, unclean };
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
function reportNewCrashDumps(app: Electron.App): number {
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
    return dumps.length;
  } catch (error) {
    // No `crashDumps` yet is the first start, not a failure.
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      log.warn(new Error("Could not read the crash dumps", { cause: error }));
    }
    return 0;
  }
}

function getCrashRecordPath(app: Electron.App) {
  return path.join(app.getPath("userData"), "last-crash.json");
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
 * Fold the previous session's dying words into this session: the event its
 * last uncaught throw wrote, logged, and kept in the exception store unless
 * that session got to store it itself.
 *
 * Removed once read, so a later boot does not report the same crash again.
 */
function reportPreviousCrash(app: Electron.App): ExceptionEvent | undefined {
  const recordPath = getCrashRecordPath(app);
  try {
    if (!fs.existsSync(recordPath)) {
      return undefined;
    }
    const contents = fs.readFileSync(recordPath, "utf8");
    fs.rmSync(recordPath, { force: true });
    if (contents.length > MAX_CRASH_RECORD_BYTES) {
      log.warn("Previous session's crash record was too large to read");
      return undefined;
    }
    const parsed = ExceptionEventSchema.safeParse(JSON.parse(contents));
    if (!parsed.success) {
      log.warn("Previous session's crash record was unreadable", parsed.error);
      return undefined;
    }
    log.error(
      `Previous session hit an uncaught exception:\n${formatExceptionEvent(parsed.data, { breadcrumbs: 0 })}`,
    );
    storeExceptionEvent(parsed.data, { once: true });
    return parsed.data;
  } catch (error) {
    log.warn(
      new Error("Could not read the previous crash record", { cause: error }),
    );
    return undefined;
  }
}

function reportProcessError(
  error: unknown,
  origin: "uncaughtException" | "unhandledRejection",
  gate: FaultGate,
) {
  if (isExpectedNetworkError(error)) {
    log.warn(`${origin} from a network failure`, error);
    return;
  }
  const event = gate.admit(
    buildMainExceptionEvent(error, { handled: false, mechanism: origin }),
  );
  if (event) {
    recordExceptionEvent(event);
  }
}

/**
 * Put an uncaught throw's event somewhere it will still be there.
 *
 * Written synchronously rather than through the logger or the exception
 * store. The file logger queues asynchronous appends with no drain on exit,
 * and the store waits a moment to write a burst at once, so
 * anything queued just before the process ends is never read. A main-process
 * throw leaves the app running, but it is the throw most likely to be
 * followed by a quit or a force-quit, and this record has to outlive either.
 * It holds the session's last uncaught throw; the store has the rest.
 *
 * The next start reads it back into the log and the store, so the record
 * still reaches the one file a user can export and the reports they send.
 */
function writeCrashRecord(app: Electron.App, event: ExceptionEvent) {
  // VS Code's own crash diagnostics carry the same latch, after a CI run
  // looped into a 386 MB log without one.
  if (isWritingCrashRecord) {
    return;
  }
  isWritingCrashRecord = true;
  try {
    fs.writeFileSync(getCrashRecordPath(app), JSON.stringify(event));
  } catch {
    // The process is ending either way, and there is nowhere left to say so.
  } finally {
    isWritingCrashRecord = false;
  }
}
