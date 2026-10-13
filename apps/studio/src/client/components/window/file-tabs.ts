import { hostPathOfFileUrl } from "@/client/lib/file-url";

import { isInside, segmentsOf } from "./host-path";
import { type ComputerTab, matchScreen } from "./window-href";

/**
 * The folder or file a computer tab's address names, the way the computer
 * route reads its search; undefined for an address that is not the
 * computer's.
 */
export function computerTabOf(href: string): ComputerTab | undefined {
  const screen = matchScreen(href);
  if (screen.kind !== "computer") {
    return;
  }
  const { kind: _computer, ...tab } = screen;
  return tab;
}

/**
 * The path the agent reaches a path on the Mac by, when a granted folder
 * covers it: the path itself. What the screen tells the conversation about a
 * file the person has open, and nothing the person sees.
 */
export function reachablePath(
  hostPath: string,
  folders: Record<string, { path: string }>,
): string | undefined {
  return Object.values(folders).some((folder) =>
    isInside(hostPath, folder.path),
  )
    ? hostPath
    : undefined;
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
