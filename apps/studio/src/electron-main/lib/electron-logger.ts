import { app, ipcMain } from "electron";
import log, {
  type LevelOption,
  type LogLevel,
  type Transport,
} from "electron-log";
import path from "node:path";

import {
  getDevLogFilePath,
  openDevLog,
  writeDevLogEntry,
} from "./dev-file-logger";

const IS_DEV = process.env.NODE_ENV === "development";

const LOG_LEVELS = [
  "error",
  "warn",
  "info",
  "verbose",
  "debug",
  "silly",
] as const satisfies readonly LogLevel[];

/**
 * How much reaches the terminal.
 *
 * Development shows warnings and errors only: everything else still lands in
 * the dev log file, which is where it gets read. `STUDIO_LOG_LEVEL` picks any
 * electron-log level for a session that wants the terminal noisier.
 */
function getConsoleLevel(): LevelOption {
  const requested = process.env.STUDIO_LOG_LEVEL;
  const level = LOG_LEVELS.find((candidate) => candidate === requested);
  if (level) {
    return level;
  }
  if (process.env.ELECTRON_ENABLE_CONSOLE_LOGGING === "true") {
    return "silly";
  }
  return IS_DEV ? "warn" : false;
}

// Rotation keeps exactly one archive (`main.old.log`), so retained history is
// twice this. Sized so that a session logging far more than boot timings and
// update checks still leaves weeks of history to correlate against, rather
// than days.
const MAX_LOG_FILE_BYTES = 8 * 1024 * 1024;

/**
 * Where the packaged build writes its log.
 *
 * Named rather than inlined into `resolvePathFn` so that the copy offered in
 * settings comes from the same file the transport writes to, with one rule for
 * where that is.
 */
export function getMainLogFilePath() {
  return path.join(app.getPath("userData"), "logs", "main.log");
}

log.transports.file.resolvePathFn = getMainLogFilePath;

log.transports.file.level = IS_DEV ? false : "info";
log.transports.file.maxSize = MAX_LOG_FILE_BYTES;

// The file transport writes synchronously by default, which puts a blocking
// syscall per line on the thread that owns the window. Queue writes instead:
// the trade is that lines still queued when the process dies are lost.
log.transports.file.sync = false;

log.transports.console.level = getConsoleLevel();

export { default as logger } from "electron-log";

export function createScopedLogger(scope: string) {
  return log.scope(scope);
}

export function initializeElectronLogging() {
  Object.assign(console, log.functions);

  if (IS_DEV) {
    // Register a custom transport so every message flowing through electron-log
    // is also written to the NDJSON dev log file — no console swizzling needed.
    const devFileTransport = (message: {
      data: unknown[];
      level: string;
      scope?: string;
    }) => {
      writeDevLogEntry(message.level, message.data, { scope: message.scope });
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
        writeDevLogEntry(entry.level, entry.args, { source: "renderer" });
      }
    });

    // Write directly to stdout so this banner never enters the log file itself.
    process.stdout.write(
      `[dev-log] Writing to ${getDevLogFilePath() ?? "unknown"}; the terminal shows warnings and errors (STUDIO_LOG_LEVEL=info for more)\n`,
    );
  }
}
