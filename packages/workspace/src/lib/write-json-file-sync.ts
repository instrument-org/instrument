import fs from "node:fs";

/**
 * Writes JSON through a temporary file and renames it into place.
 *
 * Rename within a directory is atomic, so a reader sees the whole old file or
 * the whole new one, and an interruption mid-write leaves the old one. That is
 * what the boot pass over every task in the workspace needs: it runs at the
 * moment the app is least likely to be shut down cleanly, and a truncated
 * settings file does not read as damaged. It reads as a task with no name and
 * no place in the list, and the code that would rewrite it correctly refuses to
 * touch what it cannot read, so the task stays that way.
 *
 * Named per process, so two instances sharing a workspace cannot write each
 * other's temporary file. That is all it buys: the writes are still unordered
 * across instances and the last rename wins.
 *
 * Synchronous because its callers are. The running app writes a task record
 * through `updateTaskRecord`, which does the same thing asynchronously and
 * behind a queue.
 */
export function writeJsonFileSync(target: string, value: unknown): void {
  const temporary = `${target}.${process.pid}.tmp`;

  try {
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
    fs.renameSync(temporary, target);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}
