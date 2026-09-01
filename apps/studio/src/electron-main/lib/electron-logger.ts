import { app, ipcMain, shell } from "electron";
import log, { type Transport } from "electron-log";
import fs from "node:fs";
import path from "node:path";

import {
  getDevLogFilePath,
  openDevLog,
  writeDevLogEntry,
} from "./dev-file-logger";

const IS_DEV = process.env.NODE_ENV === "development";

const ENABLE_CONSOLE_LOGGING =
  IS_DEV || process.env.ELECTRON_ENABLE_CONSOLE_LOGGING === "true";

// Rotation keeps exactly one archive (`main.old.log`), so retained history is
// twice this. Sized so that a session logging far more than boot timings and
// update checks still leaves weeks of history to correlate against, rather
// than days.
const MAX_LOG_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Where the packaged build writes its log.
 *
 * Named rather than inlined into `resolvePathFn` so that settings can reveal
 * the same file the transport writes to, with one rule for where that is.
 */
export function getMainLogFilePath() {
  return path.join(app.getPath("userData"), "logs", "main.log");
}

log.transports.file.resolvePathFn = getMainLogFilePath;

/**
 * Show the log in the file manager, and report whether anything was shown.
 *
 * Read-only by construction. It creates nothing, writes nothing, moves nothing
 * and deletes nothing, because any user can reach it from settings and the
 * worst outcome of a curious click has to be a file manager window opening
 * somewhere unhelpful.
 *
 * It falls back down to the first location that exists rather than making one.
 * The log is absent for a whole class of ordinary runs -- every development
 * run, where the file transport is off, and any packaged build whose first log
 * line has not landed yet -- and revealing a path that is not there is silently
 * nothing at all, which reads as a broken button.
 */
export async function revealMainLogFile(): Promise<boolean> {
  try {
    const filePath = getMainLogFilePath();
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return true;
    }

    const fallback = [path.dirname(filePath), app.getPath("userData")].find(
      (candidate) => fs.existsSync(candidate),
    );
    if (!fallback) {
      return false;
    }

    // Resolves to an error string rather than rejecting, so an unopenable path
    // is a `false` here instead of a rejected call the button has to catch.
    const failure = await shell.openPath(fallback);
    return failure === "";
  } catch (error) {
    log.warn(new Error("Could not reveal the log file", { cause: error }));
    return false;
  }
}

log.transports.file.level = IS_DEV ? false : "info";
log.transports.file.maxSize = MAX_LOG_FILE_BYTES;

// The file transport writes synchronously by default, which puts a blocking
// syscall per line on the thread that owns the window. Queue writes instead:
// the trade is that lines still queued when the process dies are lost.
log.transports.file.sync = false;

// Enable console logging in development or when explicitly requested
log.transports.console.level = ENABLE_CONSOLE_LOGGING ? "silly" : false;

export { default as logger } from "electron-log";

export function createScopedLogger(scope: string) {
  return log.scope(scope);
}

export function initializeElectronLogging() {
  Object.assign(console, log.functions);

  if (IS_DEV) {
    // Register a custom transport so every message flowing through electron-log
    // is also written to the NDJSON dev log file — no console swizzling needed.
    const devFileTransport = (message: { data: unknown[]; level: string }) => {
      writeDevLogEntry(message.level, message.data);
    };
    // Cast required: Transport interface mandates `transforms` but custom
    // transports that do their own serialization don't need it.
    log.transports.devFile = Object.assign(devFileTransport, {
      level: "silly",
      transforms: [],
    }) as unknown as Transport;

    openDevLog();
    // Renderer processes can't write to the dev log directly; forward their
    // errors (uncaught, unhandled rejections, explicit logger.error) over IPC
    // and tag them with source "renderer" so they're filterable.
    ipcMain.on("renderer-log", (_event, entry: unknown) => {
      if (
        typeof entry === "object" &&
        entry !== null &&
        "level" in entry &&
        "args" in entry &&
        typeof entry.level === "string" &&
        Array.isArray(entry.args)
      ) {
        writeDevLogEntry(entry.level, entry.args, "renderer");
      }
    });

    // Write directly to stdout so this banner never enters the log file itself.
    process.stdout.write(
      `[dev-log] Writing to ${getDevLogFilePath() ?? "unknown"}\n`,
    );
  }
}
