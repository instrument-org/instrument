import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** What a database leaves beside itself mid-transaction, which a copy has to carry. */
const SIDECARS = ["-wal", "-journal"];

/**
 * Reads a database an earlier build wrote through a copy of it, opened for
 * writing, and removes the copy.
 *
 * A build that quit or crashed in the middle of a write leaves a journal
 * beside its database, and SQLite has to roll that back before it can read a
 * row, which a read-only connection cannot do: it fails on a database whose
 * every row is intact. The copy carries the journal with it, so opening the
 * copy settles it there, and the original stays byte for byte as the build
 * that wrote it left it.
 *
 * Throws what SQLite or the copy throws; the caller decides what a database
 * that cannot be read means.
 */
export function readStoreCopy<T>(
  file: string,
  read: (database: DatabaseSync) => T,
): T {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "instrument-store-"));
  try {
    const copy = path.join(scratch, path.basename(file));
    fs.copyFileSync(file, copy, fs.constants.COPYFILE_FICLONE);
    for (const suffix of SIDECARS) {
      if (fs.existsSync(`${file}${suffix}`)) {
        fs.copyFileSync(
          `${file}${suffix}`,
          `${copy}${suffix}`,
          fs.constants.COPYFILE_FICLONE,
        );
      }
    }
    const database = new DatabaseSync(copy);
    try {
      return read(database);
    } finally {
      database.close();
    }
  } finally {
    fs.rmSync(scratch, { force: true, recursive: true });
  }
}
