import { type FileTab } from "@/client/atoms/orchestrator";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { fileHref } from "@/shared/computer-href";
import { MOUNT } from "@instrument-org/workspace/client";

import { useOrchestrator } from "./context";
import { isInside, segmentsOf } from "./host-path";
import { parseHref } from "./window-tabs";

/**
 * The folder or file a computer tab's address names, the way the computer
 * route reads its search; undefined for an address that is not the
 * computer's.
 */
export function computerTabOf(href: string) {
  const { pathname, search } = parseHref(href);
  if (pathname !== "/orchestrator/computer") {
    return;
  }
  const file = search.get("file");
  const tree = search.get("tree");
  return {
    ...(file === null ? {} : { file }),
    path: search.get("path") ?? "",
    root: search.get("root") ?? "~",
    ...(tree === null ? {} : { tree }),
  };
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
