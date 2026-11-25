import { type PanelFold } from "@/client/lib/panel-fold";

import { keptByTab } from "@/client/lib/kept-by-tab";

/**
 * The folder beside a file by tab, whether the person kept it or hid it and
 * whether the tab last had room for it, with the file it was beside, for
 * the screen drawn again as its tab comes back up.
 */
export const folderFoldByTab = keptByTab<{ file: string; fold: PanelFold }>();

/**
 * The folder asked for beside a file a tab is about to show: shown as it
 * comes up, where the tab has no room for both too.
 */
export function keepFolderShown(tabId: string, file: string) {
  folderFoldByTab.set(tabId, {
    file,
    fold: { hasRoom: false, isShownAnyway: true, isWanted: true },
  });
}
