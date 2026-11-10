import { isTypingTarget } from "@/client/lib/is-typing-target";

/**
 * Marks the element a file viewer scrolls its document in, so Space pressed in
 * the folder beside it can scroll the file.
 */
export const FILE_SCROLLER_ATTRIBUTE = "data-file-scroller";

/** How much of the visible height one press moves, as the browser's own Space does. */
const PAGE_FRACTION = 0.875;

/**
 * Space, or Shift+Space, pressed on the folder's rows while a file is open
 * beside them: the file moves down or up a screen, as it would with the
 * keyboard in it. Quick Look is Space's job on the rows only while no file is
 * open; with one open it is put away, and the press would otherwise do
 * nothing. Reports whether it scrolled, so the caller can take the press.
 */
export function scrollOpenFileOnSpace(
  event: {
    altKey: boolean;
    ctrlKey: boolean;
    key: string;
    metaKey: boolean;
    shiftKey: boolean;
    target: EventTarget | null;
  },
  { file, folder }: { file: Element | null; folder: Element | null },
): boolean {
  if (
    event.key !== " " ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    !(event.target instanceof Element) ||
    !folder?.contains(event.target) ||
    isTypingTarget(event.target) ||
    event.target.closest("[data-file-system-listing]") === null
  ) {
    return false;
  }
  const scroller = file?.querySelector(`[${FILE_SCROLLER_ATTRIBUTE}]`);
  if (!scroller) {
    return false;
  }
  scroller.scrollBy({
    behavior: "instant",
    top: (event.shiftKey ? -1 : 1) * scroller.clientHeight * PAGE_FRACTION,
  });
  return true;
}
