import { StoreId } from "@instrument-org/workspace/client";

import { pressToHold } from "./session";

/**
 * A press on anything the app names by an address (a bookmark, a chip in a
 * reply or the composer, a link in a reply, a row of the Chats list), which
 * past the start becomes a link held, by where in it the press was, opening
 * as the tab its address names wherever it lands; a press that goes nowhere
 * stays a click.
 */
export function pressLink(
  event: React.PointerEvent<HTMLElement>,
  link: { bookmark?: string; title: string; url: string },
) {
  const { bookmark, title, url } = link;
  pressToHold(event, () => {
    // A press in a reply starts selecting its words, which the drag ends.
    window.getSelection()?.removeAllRanges();
    return {
      ...(bookmark === undefined ? {} : { bookmark }),
      id: StoreId.newTabId(),
      kind: "link",
      title,
      url,
    };
  });
}
