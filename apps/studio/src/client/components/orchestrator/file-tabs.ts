import { type FileTab } from "@/client/atoms/orchestrator";
import { MOUNT } from "@instrument-org/workspace/client";

import { useWindowTabs } from "./window-tabs";

/** The address of a file's tab: the folder view with the file open in it. */
export function fileHref(mount: string) {
  return `/orchestrator/computer?file=${encodeURIComponent(mount)}&path=&root=~`;
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
 * Opens a file in a tab of the window and shows it. A tab already open for
 * the file is shown rather than doubled.
 */
export function useOpenFileTab() {
  const { openOrFocusScreen } = useWindowTabs();
  return (tab: FileTab) => {
    openOrFocusScreen(fileHref(tab.mount));
  };
}
