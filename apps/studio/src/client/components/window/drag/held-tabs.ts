import { type WindowTab } from "@/client/atoms/window";
import { hrefOfTarget } from "@/client/bookmarks/open-address";
import { targetOfAddress } from "@/client/bookmarks/address";
import { fileHref, folderHref } from "@/shared/computer-href";

import { groupLayoutOf, type WindowTabs } from "../tab-model";
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

/** What a tab opens as: a site's page, or a screen of the app's own. */
export type Opens = { kind: "page"; url: string } | { href: string; kind: "screen" };

/**
 * What an address opens as: a site's page, or a screen of the app's own (a
 * file or folder in Files, a chat, a built-in page). Nothing for an address
 * that names nothing the app opens, or none yet (the system's drag says a
 * link's only at the release).
 */
function openedAs(url: string): Opens | undefined {
  const target = url === "" ? undefined : targetOfAddress(url);
  if (!target) {
    return undefined;
  }
  return target.kind === "page"
    ? target
    : { href: hrefOfTarget(target), kind: "screen" };
}

/** The tabs what is held opens as, each under the id it is drawn under while held: a link's address, and each file or folder in Files. */
export function opensOf(held: Held): { id: string; opens: Opens }[] {
  switch (held.kind) {
    case "files": {
      return (held.files ?? []).flatMap((file, index) => {
        const id = held.ids[index];
        return id === undefined
          ? []
          : [{ id, opens: { href: droppedFileHref(file), kind: "screen" } }];
      });
    }
    case "link": {
      const opens = openedAs(held.url);
      return opens ? [{ id: held.id, opens }] : [];
    }
    case "folder":
    case "group":
    case "tab": {
      return [];
    }
  }
}

/**
 * The tabs what is held would be, drawn as they would stand while it is
 * held over a strip or a room: a tab as itself, files and a link as the
 * tabs their addresses open as. A whole group is its row.
 */
export function heldTabsOf(
  held: Held,
  allTabs: readonly WindowTab[],
): WindowTab[] {
  if (held.kind === "tab") {
    const tab = allTabs.find((each) => each.id === held.id);
    return tab ? [tab] : [];
  }
  return opensOf(held).map(({ id, opens }): WindowTab =>
    opens.kind === "page"
      ? {
          id,
          kind: "page",
          openedAt: 0,
          openedUrl: opens.url,
          title: held.kind === "link" ? held.title : "",
          url: opens.url,
        }
      : { href: opens.href, id, kind: "screen" },
  );
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
    case "link": {
      return [held.id];
    }
    case "folder":
    case "group": {
      return [];
    }
  }
}

/**
 * The tabs a whole group brings to a side, in their strip order, left side
 * first, and the one that comes up there: the tab up on the half its row
 * was pressed by, else the tab up on the side with the keyboard.
 */
export function tabsOfHeldGroup(
  held: Extract<Held, { kind: "group" }>,
  state: WindowTabs,
): { front: string | undefined; ids: string[] } {
  const layout = groupLayoutOf(state, held.group);
  return {
    front: layout.sides[held.half ?? layout.focused]?.up,
    ids: layout.sides.flatMap((side) => side.tabs.map((tab) => tab.id)),
  };
}
