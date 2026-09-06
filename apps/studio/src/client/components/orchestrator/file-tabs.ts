import { type FileTab } from "@/client/atoms/orchestrator";
import { MOUNT } from "@instrument-org/workspace/client";

import { useWindowTabs } from "./window-tabs";

/** The address of a file's tab: the folder view with the file open in it. */
export function fileHref(mount: string) {
  return `/orchestrator/computer?file=${encodeURIComponent(mount)}&path=&root=~`;
}

/** Where a virtual path lives on the Mac, when a granted folder covers it. */
export function hostPathOfMount(
  mount: string,
  attachedFolders: Record<string, { mountName: string; path: string }>,
): string | undefined {
  const prefix = `${MOUNT.attachedFolders}/`;
  if (!mount.startsWith(prefix)) {
    return;
  }
  const [mountName, ...rest] = mount.slice(prefix.length).split("/");
  const folder = Object.values(attachedFolders).find(
    (attached) => attached.mountName === mountName,
  );
  return folder ? [folder.path, ...rest].join("/") : undefined;
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
