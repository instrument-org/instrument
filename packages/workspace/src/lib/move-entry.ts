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
 * `from` to `to` as {@link moveEntrySync} moves it, or where `to` is a folder
 * already, each entry of `from` into it the same way, and `from` removed once
 * it is empty. An entry whose place is taken by anything but a folder to
 * merge into is left where it was and named to `onLeft`. Returns whether it
 * moved anything. Throws as `moveEntrySync` does, leaving what it had not
 * reached yet where it was.
 */
export function mergeEntrySync(
  from: string,
  to: string,
  onLeft: (from: string, to: string) => void,
): boolean {
  if (!entryExists(to)) {
    moveEntrySync(from, to);
    return true;
  }
  if (!isDirectorySync(from) || !isDirectorySync(to)) {
    onLeft(from, to);
    return false;
  }
  let moved = false;
  for (const name of fs.readdirSync(from)) {
    moved =
      mergeEntrySync(path.join(from, name), path.join(to, name), onLeft) ||
      moved;
  }
  removeIfEmptySync(from);
  return moved;
}

/** Whether a path names a folder itself, never a link to one. */
export function isDirectorySync(entry: string): boolean {
  try {
    return fs.lstatSync(entry).isDirectory();
  } catch {
    return false;
  }
}

/** Removes a folder that holds nothing; anything else stays as it is. */
export function removeIfEmptySync(dir: string): void {
  try {
    if (fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {
    // Not there, or not empty: either way it stays as it is.
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
