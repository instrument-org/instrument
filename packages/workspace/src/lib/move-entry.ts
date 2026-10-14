import fs from "node:fs";
import path from "node:path";

/** How many times a rename is tried on Windows, 100ms apart. */
const RENAME_ATTEMPTS = 10;

/**
 * Moves a file or folder to a place that is free: renamed where both are on
 * one volume, and otherwise copied to a sibling of `to` and renamed into
 * place before the original goes, so a copy cut short is never taken for a
 * finished one. Throws when either step fails, leaving `from` where it was
 * or `to` whole. Synchronous, for the migrations that run before anything
 * opens what they move.
 */
export function moveEntrySync(from: string, to: string): void {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameRetrying(from, to);
  } catch (error) {
    if (!isErrorCode(error, "EXDEV")) {
      throw error;
    }
    const partial = `${to}.partial-${process.pid.toString()}`;
    fs.rmSync(partial, { force: true, recursive: true });
    fs.cpSync(from, partial, {
      preserveTimestamps: true,
      recursive: true,
      verbatimSymlinks: true,
    });
    renameRetrying(partial, to);
    fs.rmSync(from, { force: true, recursive: true });
  }
}

/**
 * A rename, tried again for a moment on Windows, where a file another program
 * has open (an antivirus scan, the search indexer) refuses one until it lets
 * go.
 */
function renameRetrying(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (
        process.platform !== "win32" ||
        attempt >= RENAME_ATTEMPTS ||
        !["EACCES", "EBUSY", "EPERM"].some((code) => isErrorCode(error, code))
      ) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
  }
}

/** Whether a path names anything, a link to nothing included. */
export function entryExists(entry: string): boolean {
  try {
    fs.lstatSync(entry);
    return true;
  } catch {
    return false;
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
