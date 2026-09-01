import { APP_NAME } from "@instrument-org/shared";
import { app, type BrowserWindow, dialog } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { getDevLogFilePath } from "./dev-file-logger";
import { createScopedLogger, getMainLogFilePath } from "./electron-logger";

const log = createScopedLogger("DiagnosticLog");

/**
 * How much of the end of the log is shown.
 *
 * The whole file can be eight megabytes, which is neither readable nor worth
 * moving through the renderer. A problem someone is reporting happened at the
 * end of it, so the end is the part that answers.
 */
const TAIL_BYTES = 256 * 1024;

export interface LogTail {
  /** Bytes in the whole file, so the reader knows a saved copy holds more. */
  totalBytes: number;
  /** The end of the file, or all of it when it is shorter than the cap. */
  text: string;
  /** True when {@link text} is only the end of a longer file. */
  truncated: boolean;
}

export type SaveLogResult = {
  status: "canceled" | "failed" | "no-log" | "saved";
};

/**
 * The log this build is actually writing.
 *
 * Development leaves the file transport off and writes the dev log instead, so
 * naming `main.log` unconditionally points at a file that never exists there.
 * That makes the one environment the feature is built in the one environment it
 * cannot be tried in, which is how it ships broken.
 */
export function getActiveLogFilePath(): string | undefined {
  return [getDevLogFilePath(), getMainLogFilePath()].find(
    (candidate) => candidate !== undefined && fs.existsSync(candidate),
  );
}

/**
 * Read the end of the log, so someone can see what they are about to send.
 *
 * Returns nothing rather than throwing when there is no log yet, which is an
 * ordinary state on a build whose first line has not landed.
 */
export function readLogTail(): LogTail | undefined {
  const filePath = getActiveLogFilePath();
  if (!filePath) {
    return undefined;
  }

  try {
    const { size } = fs.statSync(filePath);
    const start = Math.max(0, size - TAIL_BYTES);
    const handle = fs.openSync(filePath, "r");
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(handle, buffer, 0, buffer.length, start);
      let text = buffer.toString("utf8");

      // A byte offset lands wherever it lands, so a partial first line is the
      // normal case. Showing half a line at the top reads as corruption.
      if (start > 0) {
        const firstBreak = text.indexOf("\n");
        text = firstBreak === -1 ? text : text.slice(firstBreak + 1);
      }

      return { text, totalBytes: size, truncated: start > 0 };
    } finally {
      fs.closeSync(handle);
    }
  } catch (error) {
    log.warn(new Error("Could not read the log", { cause: error }));
    return undefined;
  }
}

/**
 * Write a copy wherever the user says, and nowhere else.
 *
 * A copy rather than a path into the app's own data directory, which holds the
 * databases and settings this app runs on and is not somewhere to send anyone
 * hunting. The only write is to the destination they picked in the save panel.
 */
export async function saveLogCopy(
  parentWindow?: BrowserWindow,
): Promise<SaveLogResult> {
  const filePath = getActiveLogFilePath();
  if (!filePath) {
    return { status: "no-log" };
  }

  try {
    const stamp = new Date().toISOString().slice(0, 10);
    const defaultPath = path.join(
      app.getPath("downloads"),
      `${APP_NAME.toLowerCase()}-log-${stamp}${path.extname(filePath)}`,
    );

    // Parented so macOS presents a window-modal sheet rather than blocking the
    // whole app, matching the folder picker.
    const result = await (parentWindow
      ? dialog.showSaveDialog(parentWindow, { defaultPath })
      : dialog.showSaveDialog({ defaultPath }));

    if (result.canceled || !result.filePath) {
      return { status: "canceled" };
    }

    await fsp.copyFile(filePath, result.filePath);
    return { status: "saved" };
  } catch (error) {
    log.warn(new Error("Could not save a copy of the log", { cause: error }));
    return { status: "failed" };
  }
}
