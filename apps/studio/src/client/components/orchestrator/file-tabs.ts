import { type FileTab } from "@/client/atoms/orchestrator";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { MOUNT } from "@instrument-org/workspace/client";

import { useOrchestrator } from "./context";
import { isInside, segmentsOf } from "./host-path";

/**
 * The address of a file's tab: the folder view with the file open in it, by
 * where the file is on the computer. A page's file is shown as the page, and
 * `source` asks for its text instead.
 */
export function fileHref(hostPath: string, { source = false } = {}) {
  return `/orchestrator/computer?file=${encodeURIComponent(hostPath)}&path=&root=~${source ? "&source=true" : ""}`;
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
 * The virtual path the agent reaches a path on the Mac by, when a granted
 * folder covers it: through the deepest such folder. What the screen tells
 * the conversation about a file the person has open, and nothing the person
 * sees.
 */
export function mountOfHostPath(
  hostPath: string,
  attachedFolders: Record<string, { mountName: string; path: string }>,
): string | undefined {
  let best: undefined | { mountName: string; path: string };
  for (const folder of Object.values(attachedFolders)) {
    if (
      isInside(hostPath, folder.path) &&
      (best === undefined || folder.path.length > best.path.length)
    ) {
      best = folder;
    }
  }
  if (!best) {
    return;
  }
  // Back into the paths the agent works in, which are POSIX wherever the
  // computer's own are not: the names below the grant are what carries over,
  // never the separator they were written with.
  const below = segmentsOf(hostPath.slice(best.path.length));
  return [`${MOUNT.attachedFolders}/${best.mountName}`, ...below].join("/");
}

/**
 * What a page tab is called when the page has not said: its address, or for
 * a file shown as a page, the file's name, since its address is a path only
 * this window opens.
 */
export function pageTabTitle(tab: { title?: string; url?: string }) {
  if (tab.title) {
    return tab.title;
  }
  const filePath = hostPathOfFileUrl(tab.url);
  return filePath === undefined
    ? tab.url
    : (segmentsOf(filePath).at(-1) ?? filePath);
}

/**
 * Opens a file using the navigation policy of the surface that contains it.
 */
export function useOpenFileTab() {
  const { openScreen } = useOrchestrator();
  return (tab: FileTab) => {
    openScreen(fileHref(tab.hostPath));
  };
}
