import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { type WorkspaceFilePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { CurrentFileInfoSchema } from "./get-file-info";
import { getMimeType } from "./get-mime-type";
import { resolveWorkspaceFilePath } from "./resolve-workspace-file-path";
import { taskDir } from "./task-dir-utils";
import { resolveTaskProjectFolder } from "./task-project-folder";
import { getTaskState } from "./task-state-store";
import { buildWorkspaceFsLayout } from "./workspace-fs-layout";

/**
 * How often the stat runs. A file the user is looking at changing "within a
 * second" is what this is for; nothing here needs an exact event log.
 */
const WATCH_INTERVAL_MS = 1000;

export const WatchedFileSchema = CurrentFileInfoSchema.nullable();

/**
 * The file at a path, and every subsequent version of it, until the caller
 * stops listening.
 *
 * `fs.watchFile` rather than `fs.watch`, because what this needs is one number
 * -- has the file changed -- and `watchFile` is a stat on an interval, which
 * answers exactly that. What that buys, all of it otherwise something to build:
 * no rename semantics, no duplicate events and no network-share problem, since
 * every one of those is about interpreting events and a stat has nothing to
 * interpret; it works on a path that does not exist yet and fires when it
 * appears, which is the normal case here rather than an edge; and a deletion
 * arrives as a zeroed stat, so the missing state needs no separate signal.
 *
 * Node keys its stat watchers by filename and shares one poller across
 * listeners, so two panes on one file cost one stat -- the ref-counting is
 * upstream's, and `unwatchFile` with the listener removes only this one.
 */
export async function* watchFileInfo({
  filePath,
  // Only a test passes this. A person cannot tell a 1s poll from a 50ms one,
  // and a test should not spend a second per transition to find out.
  intervalMs = WATCH_INTERVAL_MS,
  signal,
  taskId,
}: {
  filePath: WorkspaceFilePath;
  intervalMs?: number;
  signal?: AbortSignal;
  taskId: TaskId;
}) {
  const hostPath = await resolveWorkspaceFilePath({ filePath, taskId });

  // Outside everything the task can reach. Not a file that might appear later,
  // so there is nothing to watch and one answer to give.
  if (!hostPath) {
    yield null;
    return;
  }

  /**
   * Whether the task can still reach this path at all.
   *
   * A task-relative path is reachable for as long as the task is, and never
   * needs asking. A path under a mount is reachable only while the user keeps
   * that folder attached or that project assigned, and either can be revoked
   * while the pane is showing one of its files -- after which this would go on
   * reporting a file's size and mtime out of a folder the task no longer has.
   *
   * Asked of the mount rather than of the file, so that a deleted-and-restored
   * file still reports both, which is the whole point of watching a path.
   */
  const isMountPath = filePath.startsWith("/");
  const stillReachable = async () => {
    if (!isMountPath) {
      return true;
    }
    const { attachedFolders } = await getTaskState(taskDir(taskId));
    const layout = buildWorkspaceFsLayout({
      attachedFolders,
      projectFolderName: await resolveTaskProjectFolder(taskId),
      taskHostRoot: taskDir(taskId),
    });
    return [...layout.attached, layout.project].some(
      (mount) =>
        mount !== undefined &&
        (filePath === mount.mountPoint ||
          filePath.startsWith(`${mount.mountPoint}/`)),
    );
  };

  const filename = path.basename(filePath);
  const read = async () => {
    try {
      const stats = await fs.stat(hostPath);
      return stats.isFile()
        ? {
            filename,
            filePath,
            mimeType: getMimeType(filename),
            modifiedAt: stats.mtimeMs,
          }
        : null;
    } catch {
      return null;
    }
  };

  // Handed out before each read and resolved by the next change, so a write
  // that lands while the consumer still holds the previous value resolves the
  // promise this loop is about to await rather than one nobody is waiting on.
  // Losing that signal would strand a file that is written once.
  let announce: () => void;
  let changed = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const notify = () => {
    const previous = announce;
    changed = new Promise<void>((resolve) => {
      announce = resolve;
    });
    previous();
  };

  const listener = () => {
    notify();
  };
  fsSync.watchFile(hostPath, { interval: intervalMs }, listener);
  signal?.addEventListener("abort", notify, { once: true });

  try {
    while (signal?.aborted !== true) {
      const next = changed;
      // Checked before each report rather than only at the start: the access
      // this reads through can be taken away while the pane is open, and the
      // honest answer then is the same one an unreachable path gets.
      if (!(await stillReachable())) {
        yield null;
        return;
      }
      yield await read();
      await next;
    }
  } finally {
    fsSync.unwatchFile(hostPath, listener);
    signal?.removeEventListener("abort", notify);
  }
}
