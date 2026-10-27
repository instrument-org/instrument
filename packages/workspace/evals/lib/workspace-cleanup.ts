import fs from "node:fs/promises";
import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

/**
 * A run's workspace is a temp folder of about 600 MB, most of it the
 * runtime the app builds in it (a Python base, caches, skill environments),
 * and runs that never removed theirs filled a disk with hundreds of them.
 * The records, transcripts and what the agent made are copied into the
 * run's results by `generateReport`, so once that is done the workspace is
 * removed, unless the run asked to keep it (`--keep-workspace`, for scoring
 * it again with `report`) or the copy never happened.
 */

/** Whether a finished run's workspace goes, and why it stays when it does not. */
export function workspaceVerdict({
  keep,
  recordsCopied,
}: {
  keep: boolean;
  recordsCopied: boolean;
}): { remove: true } | { reason: string; remove: false } {
  if (keep) {
    return { reason: "kept with --keep-workspace", remove: false };
  }
  if (!recordsCopied) {
    return {
      reason: "kept because its records were not copied into the results",
      remove: false,
    };
  }
  return { remove: true };
}

/**
 * Removes a finished run's workspace, and says whether it could. The app in
 * this process can still be writing its last records there (the activity
 * log, a chat's state), so a folder that fills again while it is emptied is
 * tried again before giving up, and giving up leaves the run's results as
 * they are.
 */
export async function removeWorkspace(
  workspaceRootDir: string,
): Promise<boolean> {
  try {
    await fs.rm(workspaceRootDir, {
      force: true,
      maxRetries: 10,
      recursive: true,
      retryDelay: 200,
    });
    return true;
  } catch {
    return false;
  }
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
