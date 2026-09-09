import { type FileTab } from "@/client/atoms/orchestrator";
import { MOUNT, type TaskId } from "@instrument-org/workspace/client";

import { useWindowTabs } from "./window-tabs";

/**
 * A path as a task's own reply wrote it, in the paths the conversation that
 * started it reaches the same file by.
 *
 * A task names its own folder (`output/report.md`), which means nothing
 * outside it, and the conversation reads that folder at `/tasks/<id>`. A
 * folder the task was handed is one folder under two names, since the
 * conversation granted it from a mount of its own, so where it sits on the
 * Mac is what the two agree on.
 *
 * Every screen of this window reads a path in the conversation's terms -- the
 * asset origin it loads a file from, the note telling the conversation what is
 * on screen -- so a path from a task is translated once, here, on its way in.
 */
export function conversationPathOfTaskPath({
  attachedFolders,
  conversationFolders,
  path,
  taskId,
}: {
  /** The task's own mounts, which its paths are written in. */
  attachedFolders: Record<string, { mountName: string; path: string }>;
  /** The conversation's mounts, which this window's paths are written in. */
  conversationFolders: Record<string, { mountName: string; path: string }>;
  path: string;
  taskId: TaskId;
}): string {
  if (path.startsWith(`${MOUNT.attachedFolders}/`)) {
    const hostPath = hostPathOfMount(path, attachedFolders);
    const inConversation =
      hostPath === undefined
        ? undefined
        : mountOfHostPath(hostPath, conversationFolders);
    // A folder granted to the task alone is one the conversation has no path
    // for, and the task's own is then the nearest thing to an address.
    return inConversation ?? path;
  }
  const own = `${MOUNT.task}/`;
  const inTask = path.startsWith(own) ? path.slice(own.length) : path;
  // Only the task's own folder is renamed. Any other absolute path is under a
  // mount the conversation knows by the same name or cannot reach at all, and
  // neither is this function's to rewrite.
  return inTask.startsWith("/") ? inTask : `${MOUNT.tasks}/${taskId}/${inTask}`;
}

/** The address of a file's tab: the folder view with the file open in it. */
export function fileHref(mount: string) {
  return `/orchestrator/computer?file=${encodeURIComponent(mount)}&path=&root=~`;
}

/**
 * The address of a folder's tab: the folder view standing in it.
 *
 * Rooted there rather than opened under the home folder, so the columns start
 * at the folder that was handed over instead of at the walk down to it. Takes
 * the path on the Mac, which is what the view is rooted by, and every other
 * way into a folder in this window -- a place on the home page, a path typed
 * into the omnibar -- arrives at the same address.
 */
export function folderHref(hostPath: string) {
  return `/orchestrator/computer?path=&root=${encodeURIComponent(hostPath)}`;
}

/**
 * Where a virtual path lives on the Mac: under a granted folder, or under the
 * folder of a task the conversation started, which it sees at `/tasks/<id>`.
 */
export function hostPathOfMount(
  mount: string,
  attachedFolders: Record<string, { mountName: string; path: string }>,
  taskDirs: ReadonlyMap<string, string> = new Map(),
): string | undefined {
  const attached = `${MOUNT.attachedFolders}/`;
  if (mount.startsWith(attached)) {
    const [mountName, ...rest] = mount.slice(attached.length).split("/");
    const folder = Object.values(attachedFolders).find(
      (entry) => entry.mountName === mountName,
    );
    return folder ? [folder.path, ...rest].join("/") : undefined;
  }
  const tasks = `${MOUNT.tasks}/`;
  if (mount.startsWith(tasks)) {
    const [id, ...rest] = mount.slice(tasks.length).split("/");
    const dir = id ? taskDirs.get(id) : undefined;
    return dir ? [dir, ...rest].join("/") : undefined;
  }
  return;
}

/**
 * The virtual path the agent reaches a path on the Mac by, when a granted
 * folder covers it: through the deepest such folder. The other way round from
 * {@link hostPathOfMount}, for a path the user typed rather than one a reply
 * named.
 */
export function mountOfHostPath(
  hostPath: string,
  attachedFolders: Record<string, { mountName: string; path: string }>,
): string | undefined {
  let best: undefined | { mountName: string; path: string };
  for (const folder of Object.values(attachedFolders)) {
    const inside =
      hostPath === folder.path || hostPath.startsWith(`${folder.path}/`);
    if (
      inside &&
      (best === undefined || folder.path.length > best.path.length)
    ) {
      best = folder;
    }
  }
  return best
    ? `${MOUNT.attachedFolders}/${best.mountName}${hostPath.slice(best.path.length)}`
    : undefined;
}

/**
 * Opens a file in a tab of the window and shows it. A tab already open for
 * the file is shown rather than doubled.
 */
export function useOpenFileTab() {
  const { openOrFocusScreen } = useWindowTabs();
  // Opened from somewhere else rather than asked for as a tab, so back from
  // it puts it away rather than doing nothing.
  return (tab: FileTab) => {
    openOrFocusScreen(fileHref(tab.mount), { isOpened: true });
  };
}
