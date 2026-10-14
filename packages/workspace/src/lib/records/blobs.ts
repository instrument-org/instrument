import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";

import { syncDirectory } from "./sync-directory";

/**
 * The bytes a chat's records point at (an image a tool returned, a PDF it
 * read), each in the chat's `blobs/` folder under a name made from its
 * SHA-256: `sha256-<hex>.<ext>`. The same bytes get the same name on every
 * device, so two devices writing one blob write the same file, and a blob
 * that is already there is not written again.
 */

const BLOBS = "blobs";

const BLOB_NAME = /^sha256-[0-9a-f]{64}\.[0-9a-z]+$/;

/** Blob writes under way in this process, by path, so two of one share it. */
const writing = new Map<string, Promise<string>>();

/** Whether a name is one `writeBlob` gives. */
export function isBlobName(name: string): boolean {
  return BLOB_NAME.test(name);
}

export function blobPath(dir: string, name: string): string {
  return path.join(dir, BLOBS, name);
}

/**
 * Writes bytes into `<dir>/blobs/` and answers with their name: through a
 * temporary name the sync engines skip (`.~<name>.tmp`), synced to disk,
 * then renamed into place.
 */
export function writeBlob(
  dir: string,
  bytes: Uint8Array,
  mediaType: string,
): Promise<string> {
  const hex = createHash("sha256").update(bytes).digest("hex");
  const name = `sha256-${hex}.${mime.extension(mediaType) || "bin"}`;
  const target = blobPath(dir, name);
  const pending = writing.get(target);
  if (pending) {
    return pending;
  }
  const write = writeOnce(target, bytes).then(() => name);
  writing.set(target, write);
  return write.finally(() => writing.delete(target));
}

async function writeOnce(target: string, bytes: Uint8Array): Promise<void> {
  if (await exists(target)) {
    return;
  }
  const folder = path.dirname(target);
  await fs.mkdir(folder, { recursive: true });
  const temporary = path.join(folder, `.~${path.basename(target)}.tmp`);
  try {
    const handle = await fs.open(temporary, "w");
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  await syncDirectory(folder);
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.stat(file);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
