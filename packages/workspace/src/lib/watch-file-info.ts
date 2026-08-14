import { mergeGenerators } from "@instrument-org/shared/merge-generators";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { publisher } from "../rpc/publisher";
import { type WorkspaceFilePath } from "../schemas/paths";
import { type TaskId } from "../schemas/task-id";
import { CurrentFileInfoSchema } from "./get-file-info";
import { getMimeType } from "./get-mime-type";
import { resolveWorkspaceFilePath } from "./resolve-workspace-file-path";
import { taskDir } from "./task-dir-utils";
import { resolveTaskProjectFolder } from "./task-project-folder";
import { getTaskState } from "./task-record";
import { buildWorkspaceFsLayout, resolveHostPath } from "./workspace-fs-layout";

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
   * The real directory currently behind this path, or undefined if nothing is.
   *
   * Asked of the mount rather than of the file: a deleted-and-restored file
   * still reports both, which is the whole point of watching a path, and a file
   * that has not been written yet is the pane's normal case rather than an
   * unreachable one.
   */
  const mountHostRoot = async () => {
    const { attachedFolders } = await getTaskState(taskDir(taskId));
    const layout = buildWorkspaceFsLayout({
      attachedFolders,
      projectFolderName: await resolveTaskProjectFolder(taskId),
      taskHostRoot: taskDir(taskId),
    });
    return resolveHostPath(layout, filePath)?.mount.hostRoot;
  };

  /**
   * Whether the task can still reach this path, through the same folder it did
   * when the watch started.
   *
   * A task-relative path is reachable for as long as the task is, and never
   * needs asking. A path under a mount is reachable only while the user keeps
   * that folder attached or that project assigned, and either can be revoked
   * while the pane is showing one of its files -- after which this would go on
   * reporting a file's size and mtime out of a folder the task no longer has.
   *
   * The mount point is not the question, the directory under it is: attaching a
   * different folder under the name the old one had leaves `/mnt/Shared/note.md`
   * resolving, to a file in somebody else's directory, while the stat below
   * still reads the folder the user took away.
   */
  const isMountPath = filePath.startsWith("/");
  const grantedHostRoot = isMountPath ? await mountHostRoot() : undefined;
  const stillReachable = async () => {
    if (!isMountPath) {
      return true;
    }
    const current = await mountHostRoot();
    return current !== undefined && current === grantedHostRoot;
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

  /**
   * The stat, running only while the task can reach the path. A revoked folder
   * is one nothing here may look at, so the poll stops with the access rather
   * than going on reading a directory the user took away, and starts again if
   * the access comes back.
   */
  let polling = false;
  const poll = (wanted: boolean) => {
    if (wanted === polling) {
      return;
    }
    polling = wanted;
    if (wanted) {
      fsSync.watchFile(hostPath, { interval: intervalMs }, listener);
    } else {
      fsSync.unwatchFile(hostPath, listener);
    }
  };

  signal?.addEventListener("abort", notify, { once: true });

  // Losing a folder is not a change to the file, so the stat that wakes this
  // loop never fires for one: a detached folder would sit here reporting its
  // files until something happened to write one of them. The task's own change
  // events are what a revoked mount arrives as, and what its return arrives as
  // too, since the stat is stopped for as long as the access is gone. Only a
  // change in reachability wakes the loop, because a tab opening publishes on
  // the same channel and has nothing to say about this file.
  const watchingTask = new AbortController();
  if (isMountPath) {
    void (async () => {
      const updates = mergeGenerators([
        publisher.subscribe("task.updated", { signal: watchingTask.signal }),
        publisher.subscribe("task.stateUpdated", {
          signal: watchingTask.signal,
        }),
      ]);
      let wasReachable = true;
      for await (const payload of updates) {
        if (payload.id !== taskId) {
          continue;
        }
        const reachable = await stillReachable();
        if (reachable !== wasReachable) {
          wasReachable = reachable;
          notify();
        }
      }
    })().catch(() => {
      // The subscription ends with the watch, which aborts it; nothing here
      // outlives the loop below to report to.
    });
  }

  try {
    while (signal?.aborted !== true) {
      const next = changed;
      // Checked before each report rather than only at the start: the access
      // this reads through can be taken away while the pane is open, and given
      // back, and while it is gone the honest answer is the one an unreachable
      // path gets. The watch outlives the loss instead of ending on it, because
      // the caller is a pane that is still open: end here and re-attaching the
      // folder leaves it on the missing state with nothing left to tell it the
      // file is back.
      const reachable = await stillReachable();
      // Before the read, so a write landing between the two wakes the loop
      // rather than going unnoticed until the next one.
      poll(reachable);
      yield reachable ? await read() : null;
      await next;
    }
  } finally {
    poll(false);
    signal?.removeEventListener("abort", notify);
    watchingTask.abort();
  }
}
