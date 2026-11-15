import { pressToDrag } from "./session";

/** The id a link stands under while held (in a strip, a room, among the bookmarks), where nothing kept stands for it. */
export const STANDING_ID = ":standing";

/**
 * A press on anything the app names by an address (a bookmark, a chip in a
 * reply or the composer, a link in a reply, a row of the Chats list), which
 * past the start becomes a link held, by where in it the press was, opening
 * as the tab its address names wherever it lands; a press that goes nowhere
 * stays a click. A bookmark is held as itself, under its own id.
 */
export function pressLink(
  event: React.PointerEvent<HTMLElement>,
  link: { bookmark?: string; title: string; url: string },
) {
  const element = event.currentTarget;
  const pressedAt = { x: event.clientX, y: event.clientY };
  const { bookmark, title, url } = link;
  pressToDrag(event, () => {
    const bounds = element.getBoundingClientRect();
    // A press in a reply starts selecting its words, which the drag ends.
    window.getSelection()?.removeAllRanges();
    return {
      grab: { x: pressedAt.x - bounds.left, y: pressedAt.y - bounds.top },
      held:
        bookmark === undefined
          ? { id: STANDING_ID, kind: "link", title, url }
          : { id: bookmark, isKept: true, kind: "link", title, url },
    };
  });
}
