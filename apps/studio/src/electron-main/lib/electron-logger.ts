import {
  app,
} from "electron";
import log, { type Transport } from "electron-log";
import path from "node:path";

import {
  getDevLogFilePath,
  openDevLog,
  writeDevLogEntry,
} from "./dev-file-logger";

const IS_DEV = process.env.NODE_ENV === "development";

const ENABLE_CONSOLE_LOGGING =
  IS_DEV || process.env.ELECTRON_ENABLE_CONSOLE_LOGGING === "true";

log.transports.file.resolvePathFn = () => {
  return path.join(app.getPath("userData"), "logs", "main.log");
};

log.transports.file.level = IS_DEV ? false : "info";

// Enable console logging in development or when explicitly requested
log.transports.console.level = ENABLE_CONSOLE_LOGGING ? "silly" : false;

export {
  default as logger,
} from "electron-log";

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
    // Write directly to stdout so this banner never enters the log file itself.
    process.stdout.write(
      `[dev-log] Writing to ${getDevLogFilePath() ?? "unknown"}\n`,
    );
  }
}
