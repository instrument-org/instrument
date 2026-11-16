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
