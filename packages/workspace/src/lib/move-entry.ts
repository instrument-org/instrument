import fs from "node:fs";
import path from "node:path";

/** How many times a rename is tried on Windows, 100ms apart. */
const RENAME_ATTEMPTS = 10;

/**
 * What an entry renamed aside to be deleted is called after its own name,
 * before the process and time that make it unique (`setAsideSync`).
 */
export const ASIDE_INFIX = ".moved-";

/**
 * What a copy being made across volumes is called after the name it is
 * renamed to once whole, before the process that makes it.
 */
export const PARTIAL_INFIX = ".partial-";

/**
 * Moves a file or folder to a place that is free: renamed where both are on
 * one volume, and otherwise copied as {@link placeEntrySync} copies it, and
 * the original then renamed aside and deleted (`setAsideSync`), so neither a
 * copy cut short nor an original deleted part-way is ever found under its
 * own name. A delete that fails leaves only the aside, which nothing reads.
 * Throws when a copy or rename fails, leaving `from` where it was or `to`
 * whole. Synchronous, for the migrations that run before anything opens
 * what they move.
 */
export function moveEntrySync(from: string, to: string): void {
  if (placeEntrySync(from, to) === "copied") {
    const aside = setAsideSync(from);
    try {
      removeEntrySync(aside);
    } catch {
      // Under a name nothing opens: left for good rather than read.
    }
  }
}

/**
 * Puts a file or folder at a place that is free: renamed where both are on
 * one volume, and otherwise copied, links as links, to a sibling of `to`
 * (`<to>.partial-<pid>`) and renamed into place once whole, so a copy cut
 * short is never taken for a finished one. `beforeRename` runs on the whole
 * copy before it takes its place. Answers which it did: a copy leaves `from`
 * where it was, for the caller to remove. Throws when a step fails, leaving
 * `from` where it was and `to` free but for a partial copy.
 */
export function placeEntrySync(
  from: string,
  to: string,
  beforeRename?: (copy: string) => void,
): "copied" | "renamed" {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    renameRetrying(from, to);
    return "renamed";
  } catch (error) {
    if (!isErrorCode(error, "EXDEV")) {
      throw error;
    }
  }
  const partial = `${to}${PARTIAL_INFIX}${process.pid.toString()}`;
  removeEntrySync(partial);
  fs.cpSync(from, partial, {
    preserveTimestamps: true,
    recursive: true,
    verbatimSymlinks: true,
  });
  beforeRename?.(partial);
  renameRetrying(partial, to);
  return "copied";
}

/**
 * Renames an entry aside beside itself, on its own volume, which is one
 * step: `<name>.moved-<pid>-<time>`, a name nothing opens. Answers where it
 * went. The first half of deleting something whose delete may stop
 * part-way, so what is left is never found under its own name.
 */
export function setAsideSync(entry: string): string {
  const aside = `${entry}${ASIDE_INFIX}${process.pid.toString()}-${Date.now().toString()}`;
  renameRetrying(entry, aside);
  return aside;
}

/** The entries `setAsideSync` left beside `entry`, by their whole paths. */
export function asidesOf(entry: string): string[] {
  const prefix = `${path.basename(entry)}${ASIDE_INFIX}`;
  try {
    return fs
      .readdirSync(path.dirname(entry))
      .filter((name) => name.startsWith(prefix))
      .map((name) => path.join(path.dirname(entry), name));
  } catch {
    return [];
  }
}

/**
 * Deletes a file or folder. A link is unlinked, never followed, so what it
 * points to is left as it is; a folder goes with everything in it, retried
 * for a moment where Windows holds a file open. Nothing there is nothing to
 * do. Throws when the delete fails, which may leave part of a folder.
 */
export function removeEntrySync(entry: string): void {
  let stats: fs.Stats;
  try {
    stats = fs.lstatSync(entry);
  } catch {
    return;
  }
  if (stats.isDirectory()) {
    fs.rmSync(entry, { force: true, maxRetries: 3, recursive: true });
  } else {
    fs.unlinkSync(entry);
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
