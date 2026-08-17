import { zoomAtom } from "@/client/atoms/zoom";
import { useAtomValue } from "jotai";
import { type RefObject, useLayoutEffect, useState } from "react";

/** Layout px held between the composer and a menu of its own. */
const COMPOSER_MENU_GAP = 4;

/**
 * Layout px: the 18rem cap both composer menus carry, which is the most room
 * either can ask for. Kept in step with the `max-h-` they are capped by, and
 * only ever decides which side they open on -- a menu that opens on the side
 * with less room than this still fits, it just scrolls sooner.
 */
const COMPOSER_MENU_MAX_HEIGHT = 18 * 16;

/** What a menu has to be given to sit against the composer rather than over it. */
interface ComposerMenuPlacement {
  /** Radix `alignOffset`: back out to the composer's near edge. */
  alignOffset: number;
  side: "bottom" | "top";
  /** Radix `sideOffset`: clear of the composer, plus the gap. */
  sideOffset: number;
  /** Layout px, the unit the menu re-applies zoom to. Unset until measured. */
  width?: number;
}

const UNMEASURED: ComposerMenuPlacement = {
  alignOffset: 0,
  side: "bottom",
  sideOffset: 0,
};

/**
 * Places a menu the composer owns against the outside of the composer: as wide
 * as the box the prompt is written in, and one gap clear of its bottom edge, or
 * of its top edge where the composer is pinned to the bottom of the window. A
 * menu that covers the prompt it is adding to reads as painted over it rather
 * than as part of it.
 *
 * Radix positions against the trigger, and every one of these hangs off
 * something inside the composer -- the plus button, the column the caret is in
 * -- so the offsets are what carries the menu back out to the edge. That is
 * also why the side is decided here rather than left to Radix: a flip it made
 * on its own would keep an offset measured for the side it flipped away from.
 * Its collision handling is off for the same reason, and the menu's own
 * available-height cap is what keeps it inside the window instead.
 *
 * Rects are on-screen px, the space Radix applies its offsets in. The width is
 * the one value the content applies to itself, so it converts to the layout px
 * the self-zoomed content is laid out in.
 *
 * Measured when the menu opens, and again whenever the composer resizes under
 * it -- a draft growing a line while the slash menu is open moves the edge the
 * menu is held against.
 *
 * The composer arrives as an element rather than as a ref because a child's
 * layout effect runs before its parent's ref has been attached: a menu that
 * read the box out of a ref would find nothing there the first time it looked.
 * The anchor is its own component's, which is attached by then.
 */
export function useComposerMenuPlacement({
  anchorRef,
  bounds,
  open,
}: {
  /** What Radix positions against, somewhere inside the composer. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The composer box the menu hangs off. */
  bounds: HTMLElement | null;
  open: boolean;
}): ComposerMenuPlacement {
  const zoom = useAtomValue(zoomAtom);
  const [placement, setPlacement] = useState(UNMEASURED);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor || !bounds) {
      return;
    }

    const measure = () => {
      const anchorBox = anchor.getBoundingClientRect();
      const box = bounds.getBoundingClientRect();
      const gap = COMPOSER_MENU_GAP * zoom;
      // Below the prompt is where a list of what can be added to it reads as
      // coming from, so that is the side unless the menu cannot open there:
      // below a composer pinned to the bottom of the window there is nothing
      // but the window edge. Failing that, whichever side has more room.
      const roomBelow = window.innerHeight - box.bottom - gap;
      const side =
        roomBelow >= COMPOSER_MENU_MAX_HEIGHT * zoom || roomBelow >= box.top
          ? "bottom"
          : "top";
      const next: ComposerMenuPlacement = {
        alignOffset: box.left - anchorBox.left,
        side,
        sideOffset:
          (side === "bottom"
            ? box.bottom - anchorBox.bottom
            : anchorBox.top - box.top) + gap,
        width: box.width / zoom,
      };
      setPlacement((current) =>
        current.alignOffset === next.alignOffset &&
        current.side === next.side &&
        current.sideOffset === next.sideOffset &&
        current.width === next.width
          ? current
          : next,
      );
    };

    // Measured here rather than left to the observer's first callback, which
    // lands a frame later: the menu is already on screen by then.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(anchor);
    observer.observe(bounds);
    return () => {
      observer.disconnect();
    };
  }, [anchorRef, bounds, open, zoom]);

  return placement;
}
