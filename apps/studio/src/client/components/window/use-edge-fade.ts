import { cancelFrame, frame } from "motion/react";
import { type RefObject, useEffect } from "react";

/** How far in a tab row's end fades, in layout px: the `1.5rem` of `EDGE_FADE`. */
export const EDGE_FADE_WIDTH = 24;

/**
 * The fade `ScrollArea` wears, for a row of tabs to put on. It only shows while
 * `useEdgeFade` marks the row, since a mask cuts whatever is drawn past its box
 * and the tabs at rest draw their shadows there. Across the row's height it lets
 * them through either way.
 */
export const EDGE_FADE =
  "data-edge-fade:mask-l-from-[calc(100%-min(1.5rem,var(--edge-fade-start)))] data-edge-fade:mask-r-from-[calc(100%-min(1.5rem,var(--edge-fade-end)))] data-edge-fade:[mask-clip:no-clip] data-edge-fade:[mask-repeat:repeat-y]";

/**
 * Fades a row of tabs at an end with something past it: the tab being dragged
 * over that end, and on a row that `scrolls`, the tabs it can scroll to. The
 * fade grows with what is past the end, up to its whole width, so a tab reaching
 * the end is never cut before it has begun to fade.
 *
 * `lifted` selects what is being dragged, while it is. A tab let go may still be
 * past the end, so the fade follows it home.
 */
export function useEdgeFade(
  rowRef: RefObject<HTMLElement | null>,
  {
    lifted,
    scrolls = false,
  }: { lifted: string | undefined; scrolls?: boolean },
) {
  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const update = () => {
      fadeEnds(row, lifted, scrolls);
    };
    update();
    if (lifted !== undefined) {
      // After Motion has written the frame's transforms, and before it is drawn.
      frame.postRender(update, true);
      return () => {
        cancelFrame(update);
        const followHome = () => {
          if (!fadeEnds(row, lifted, scrolls)) {
            cancelFrame(followHome);
          }
        };
        frame.postRender(followHome, true);
      };
    }
    if (!scrolls) {
      return;
    }
    row.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    if (row.firstElementChild) {
      observer.observe(row.firstElementChild);
    }
    return () => {
      row.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [lifted, rowRef, scrolls]);
}

/** Writes the row's fades, and says whether anything lifted is past an end. */
function fadeEnds(
  row: HTMLElement,
  lifted: string | undefined,
  scrolls: boolean,
): boolean {
  let start = scrolls ? row.scrollLeft : 0;
  let end = scrolls ? row.scrollWidth - row.clientWidth - row.scrollLeft : 0;
  let isPast = false;
  if (lifted !== undefined) {
    const box = row.getBoundingClientRect();
    // Rects are on-screen px and the fade is layout px, which differ by the
    // window's zoom.
    const zoom = box.width / row.offsetWidth;
    for (const tab of row.querySelectorAll(lifted)) {
      const { left, right } = tab.getBoundingClientRect();
      const pastStart = (box.left - left) / zoom;
      const pastEnd = (right - box.right) / zoom;
      isPast ||= pastStart >= 1 || pastEnd >= 1;
      start = Math.max(start, pastStart);
      end = Math.max(end, pastEnd);
    }
  }
  // A fraction of a pixel is what a zoomed row's scroll stops short of its end by.
  const startPx = start < 1 ? 0 : Math.round(start);
  const endPx = end < 1 ? 0 : Math.round(end);
  if (startPx === 0 && endPx === 0) {
    row.removeAttribute("data-edge-fade");
  } else {
    row.setAttribute("data-edge-fade", "");
    row.style.setProperty("--edge-fade-start", `${startPx}px`);
    row.style.setProperty("--edge-fade-end", `${endPx}px`);
  }
  return isPast;
}
