// A full disk reaches us wrapped: the store's `TypedError.Storage` carries the
// driver's error as its `cause`, and a file write carries a Node system error.
// Walk the cause chain rather than inspect the top-level error.

// SQLite primary result codes. `node:sqlite` puts the numeric code on
// `errcode` (possibly an extended code, whose low byte is the primary one);
// other drivers put the symbolic name on `code`.
const SQLITE_FULL = 13;
const SQLITE_CANTOPEN = 14;

const STORAGE_FULL_CODES = new Set([
  "ENOSPC",
  "SQLITE_CANTOPEN",
  "SQLITE_FULL",
]);

const STORAGE_FULL_MESSAGE = "database or disk is full";

const MAX_CAUSE_DEPTH = 10;

/**
 * Detects a write that failed because the disk has no space left. Besides
 * ENOSPC and SQLITE_FULL this counts SQLITE_CANTOPEN ("unable to open database
 * file"), which is what SQLite reports when it cannot create its journal on a
 * full disk. That code can also mean a missing directory or a permission
 * problem, but for an already-open task database mid-write, a full disk is the
 * cause seen in practice.
 */
export function isStorageFullError(error: unknown): error is Error {
  let current: unknown = error;

  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      break;
    }

    if (
      "code" in current &&
      typeof current.code === "string" &&
      STORAGE_FULL_CODES.has(current.code)
    ) {
      return true;
    }

    if ("errcode" in current && typeof current.errcode === "number") {
      const primaryCode = current.errcode & 0xff;
      if (primaryCode === SQLITE_FULL || primaryCode === SQLITE_CANTOPEN) {
        return true;
      }
    }

    if (current.message.toLowerCase().includes(STORAGE_FULL_MESSAGE)) {
      return true;
    }

    current = current.cause;
  }

  return false;
}
