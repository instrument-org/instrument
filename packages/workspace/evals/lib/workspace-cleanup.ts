import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/**
 * A run's workspace is a temp folder of 500 to 700 MB, nearly all of it
 * `runtime/`: the Python base, its download cache, bytecode and the skills'
 * environments, which every run builds again from scratch. What the run
 * did (the chats' records, the folders and files it made, the run records
 * `report` rescores from) is well under a megabyte, so once a run is
 * reported only its runtime goes, unless it asked to keep everything
 * (`--keep-workspace`). Runs that never removed theirs filled a disk with
 * hundreds of them.
 */
export function removeRuntime(workspaceRootDir: string): Promise<void> {
  return fs.rm(path.join(workspaceRootDir, "runtime"), {
    force: true,
    // The app in this process can still be writing there as it shuts down.
    maxRetries: 10,
    recursive: true,
    retryDelay: 200,
  });
}

/** Free space a case needs on the volume holding the temp folder. */
export const MIN_FREE_DISK_BYTES = 20 * 1024 ** 3;

/** How often a waiting case looks again. */
const DISK_RECHECK_MS = 30_000;

/** How long a case waits for room before its run fails. */
const DISK_WAIT_TIMEOUT_MS = 30 * 60_000;

/** Free bytes on the volume holding `dir`, as a process may use them. */
async function freeBytes(dir: string): Promise<number> {
  const stats = await fs.statfs(dir);
  return stats.bavail * stats.bsize;
}

/**
 * Waits until the temp folder's volume has {@link MIN_FREE_DISK_BYTES}
 * free, saying once why it waits, and throws once `timeoutMs` passes
 * without it. Every case's workspace is built there, so a case started on
 * a nearly full disk fails partway or fills it for everything else.
 */
export async function waitForDisk({
  free = () => freeBytes(os.tmpdir()),
  minBytes = MIN_FREE_DISK_BYTES,
  onWait,
  recheckMs = DISK_RECHECK_MS,
  timeoutMs = DISK_WAIT_TIMEOUT_MS,
}: {
  free?: () => Promise<number>;
  minBytes?: number;
  onWait: (freeBytes: number) => void;
  recheckMs?: number;
  timeoutMs?: number;
}): Promise<void> {
  const startedAt = Date.now();
  let told = false;
  for (;;) {
    const available = await free();
    if (available >= minBytes) {
      return;
    }
    if (!told) {
      onWait(available);
      told = true;
    }
    if (Date.now() - startedAt + recheckMs > timeoutMs) {
      throw new Error(
        `Only ${formatGB(available)} free on the disk holding ${os.tmpdir()}, under the ${formatGB(minBytes)} a case needs, after waiting ${Math.round(timeoutMs / 60_000)} minutes. Free some space and run again.`,
      );
    }
    await delay(recheckMs);
  }
}

export function formatGB(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
