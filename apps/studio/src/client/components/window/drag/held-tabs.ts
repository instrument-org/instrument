import { type WindowTab } from "@/client/atoms/window";
import { hrefOfTarget } from "@/client/bookmarks/open-address";
import { targetOfAddress } from "@/client/bookmarks/address";
import { fileHref, folderHref } from "@/shared/computer-href";

import { type DroppedFile, type Held } from "./types";

/** The files a drop carries, by path, folders told from files. */
export function filesOfDrop(transfer: DataTransfer): DroppedFile[] {
  return [...transfer.items].flatMap((item) => {
    const file = item.kind === "file" ? item.getAsFile() : null;
    const hostPath = file ? window.api.getFilePath(file) : "";
    return hostPath
      ? [{ hostPath, isFolder: item.webkitGetAsEntry()?.isDirectory ?? false }]
      : [];
  });
}

/** The tab a file opens as, as opening it in Files does, or Files at a folder. */
export function droppedFileHref({ hostPath, isFolder }: DroppedFile) {
  return isFolder ? folderHref(hostPath) : fileHref(hostPath);
}

/**
 * The tabs what is held would be, drawn as they would stand while it is
 * held over a strip or a room: a tab as itself, files one each under the
 * ids kept for the drag, a bookmark as the tab it opens. A whole group is
 * its row, and no tab.
 */
export function heldTabsOf(
  held: Held,
  allTabs: readonly WindowTab[],
): WindowTab[] {
  switch (held.kind) {
    case "tab": {
      const tab = allTabs.find((each) => each.id === held.id);
      return tab ? [tab] : [];
    }
    case "files": {
      return (held.files ?? []).flatMap((file, index) => {
        const id = held.ids[index];
        return id === undefined
          ? []
          : [{ href: droppedFileHref(file), id, kind: "screen" as const }];
      });
    }
    case "bookmark": {
      const target = targetOfAddress(held.url);
      if (!target) {
        return [];
      }
      return [
        target.kind === "page"
          ? {
              id: held.id,
              kind: "page",
              openedAt: 0,
              openedUrl: target.url,
              title: held.title,
              url: target.url,
            }
          : { href: hrefOfTarget(target), id: held.id, kind: "screen" },
      ];
    }
    case "group": {
      return [];
    }
  }
}

/** The strip keys what is held is drawn under, which a measure of a strip leaves out. */
export function heldKeysOf(held: Held): string[] {
  switch (held.kind) {
    case "tab": {
      return [held.key];
    }
    case "files": {
      return [...held.ids];
    }
    case "bookmark": {
      return [held.id];
    }
    case "group": {
      return [];
    }
  }
}
