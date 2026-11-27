import { addressOfTab, fileAddressOf } from "@/client/bookmarks/address";
import { StoreId } from "@instrument-org/workspace/client";

import { pressToHold } from "./session";

/**
 * A press on a bookmark of the bar or of one of its folders, which past the
 * start becomes the bookmark held by the pointer, as a tab is: it moves
 * along the bar, opens as its tab wherever a tab lands, and goes from the
 * bar where nothing takes it. A press that goes nowhere stays a click.
 * `onHeld` is told as it becomes a drag, for a list it is in to pick it.
 */
export function pressBookmark(
  event: React.PointerEvent<HTMLElement>,
  bookmark: { id: string; title: string; url: string },
  onHeld?: () => void,
) {
  pressToHold(event, () => {
    onHeld?.();
    return {
      bookmark: bookmark.id,
      id: StoreId.newTabId(),
      kind: "link",
      title: bookmark.title,
      url: bookmark.url,
    };
  });
}

/**
 * A press on rows of the Bookmarks page held together, several picked or a
 * folder (`ids`, in the page's order), which past the start become them
 * held by the pointer: they move among the page's rows and land nowhere
 * else. A press that goes nowhere stays a click. `onHeld` is told as it
 * becomes a drag.
 */
export function pressRows(
  event: React.PointerEvent<HTMLElement>,
  rows: { ids: readonly string[]; title: string },
  onHeld?: () => void,
) {
  pressToHold(event, () => {
    onHeld?.();
    return { ids: rows.ids, kind: "rows", title: rows.title };
  });
}

/**
 * A press on Apps, Chats or Files at the bookmarks bar's start, or on a row
 * of their menus, which past the start becomes a link to what it opens
 * (`href`, a screen of the app's own, or `url`, a site) held by the pointer
 * as a bookmark is: it opens as its tab wherever a bookmark does, goes on
 * the bar as a new bookmark, and lands nowhere where nothing takes it. A
 * press that goes nowhere stays a click. `onHeld` is told as it becomes a
 * drag, for a menu it was in to get out of the way.
 */
export function pressShortcut(
  event: React.PointerEvent<HTMLElement>,
  shortcut: { title: string } & ({ href: string } | { url: string }),
  onHeld?: () => void,
) {
  const url =
    "url" in shortcut
      ? shortcut.url
      : addressOfTab({ href: shortcut.href, kind: "screen" });
  if (url === undefined) {
    return;
  }
  pressToHold(event, () => {
    onHeld?.();
    return {
      id: StoreId.newTabId(),
      kind: "link",
      shortcut: true,
      title: shortcut.title,
      url,
    };
  });
}

/**
 * A press on a place of Files' sidebar, of the bar's Files menu or of the
 * side panel, which past the start becomes the place held by the pointer,
 * as a bookmark is: a link to Files at that folder, never the folder
 * itself, so nothing is handed out of the app to copy. It opens as a tab
 * from a strip, goes on the bookmarks bar, goes with a message from a
 * composer's box, and moves along Favorites or is added there; a row of
 * Favorites (`favorites`, the rows' paths in order) let go where nothing
 * takes it leaves Favorites. One from outside a page (`shortcut`, the bar's
 * Files menu or the side panel) also opens as its tab wherever a bookmark
 * does, a page's outer edge included. A press that goes nowhere stays a
 * click. `onHeld` is told as it becomes a drag, for a menu it was in to get
 * out of the way.
 */
export function pressPlace(
  event: React.PointerEvent<HTMLElement>,
  place: {
    name: string;
    path: string;
    favorites?: readonly string[];
    shortcut?: true;
  },
  onHeld?: () => void,
) {
  pressToHold(event, () => {
    onHeld?.();
    return {
      id: StoreId.newTabId(),
      kind: "link",
      place: {
        path: place.path,
        ...(place.favorites ? { favorites: place.favorites } : {}),
      },
      ...(place.shortcut ? { shortcut: true } : {}),
      title: place.name,
      url: fileAddressOf(place.path, { isFolder: true }),
    };
  });
}

/**
 * A press on a folder of the bar, which past the start becomes the folder
 * held by the pointer: it moves along the bar, and opens as the tabs of the
 * bookmarks in it (`items`) wherever a bookmark opens as its tab. A press
 * that goes nowhere stays the press that opens its menu.
 */
export function pressFolder(
  event: React.PointerEvent<HTMLElement>,
  folder: { id: string; title: string },
  items: readonly { title: string; url: string }[],
) {
  pressToHold(event, () => ({
    folder: folder.id,
    kind: "folder",
    links: items.map(({ title, url }) => ({
      id: StoreId.newTabId(),
      title,
      url,
    })),
    title: folder.title,
  }));
}
