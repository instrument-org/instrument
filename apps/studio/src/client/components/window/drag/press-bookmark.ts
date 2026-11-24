import { fileAddressOf } from "@/client/bookmarks/address";
import { StoreId } from "@instrument-org/workspace/client";

import { pressToHold } from "./session";

/**
 * A press on a bookmark of the bar or of one of its folders, which past the
 * start becomes the bookmark held by the pointer, as a tab is: it moves
 * along the bar, opens as its tab wherever a tab lands, and goes from the
 * bar where nothing takes it. A press that goes nowhere stays a click.
 */
export function pressBookmark(
  event: React.PointerEvent<HTMLElement>,
  bookmark: { id: string; title: string; url: string },
) {
  pressToHold(event, () => ({
    bookmark: bookmark.id,
    id: StoreId.newTabId(),
    kind: "link",
    title: bookmark.title,
    url: bookmark.url,
  }));
}

/**
 * A press on a place of Files' sidebar or of the bar's Files menu, which
 * past the start becomes the place held by the pointer, as a bookmark is:
 * a link to Files at that folder, never the folder itself, so nothing is
 * handed out of the app to copy. It opens as a tab from a strip, goes on
 * the bookmarks bar, goes with a message from a composer's box, and moves
 * along Favorites or is added there; a row of Favorites (`favorites`, the rows' paths in
 * order) let go where nothing takes it leaves Favorites. A press that goes nowhere stays a click. `onHeld` is told as it
 * becomes a drag, for a menu it was in to get out of the way.
 */
export function pressPlace(
  event: React.PointerEvent<HTMLElement>,
  place: { name: string; path: string; favorites?: readonly string[] },
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
      title: place.name,
      url: fileAddressOf(place.path, { isFolder: true }),
    };
  });
}

/**
 * A press on a folder of the bar, which past the start becomes the folder
 * held by the pointer: it moves along the bar and nowhere else. A press
 * that goes nowhere stays the press that opens its menu.
 */
export function pressFolder(
  event: React.PointerEvent<HTMLElement>,
  folder: { id: string; title: string },
) {
  pressToHold(event, () => ({
    folder: folder.id,
    kind: "folder",
    title: folder.title,
  }));
}
