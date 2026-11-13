import {
  PANE_COLLAPSE_THRESHOLD,
  PANE_DEFAULT_SHARE,
  PANE_WIDTH_MIN,
  shareOfWidth,
  widthOfShare,
} from "@/client/atoms/right-pane";
import { paneShareAtom } from "@/client/atoms/window";
import { zoomAtom } from "@/client/atoms/zoom";
import { ResizeHandle } from "@/client/components/resize-handle";
import { RAIL_SLIDE_TRANSITION } from "@/client/lib/rail-motion";
import { cn } from "@/client/lib/utils";
import { useAtom, useAtomValue } from "jotai";
import {
  animate,
  type AnimationPlaybackControls,
  motion,
  useMotionValue,
} from "motion/react";
import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { WINDOW_CARD, WINDOW_CARD_GAP } from "./window-frame";

/** One side of a split: a card, its own head over what it shows. */
export interface SplitPane {
  body: ReactNode;
  head?: ReactNode;
}

/**
 * Two panes side by side, each a card of its own, with the window's gap
 * between them. The start pane flexes and the end pane is sized, so a drag
 * in the gap is one number, and opening or closing the end pane slides it in
 * or out at its width rather than squeezing what it holds. What the end pane
 * holds stays mounted while it is closed, since the pages in it are guests
 * that would be lost with it; it is only clipped away.
 *
 * What is kept is the end pane's share of the row, re-measured whenever the
 * row changes, the window's zoom included; see `atoms/right-pane.ts` for why.
 *
 * Told to fill, the end pane is the row: the start pane is put away and the
 * end pane takes the whole width with no gap to drag. Each pane's body stays
 * where it is in the tree whatever the split does, so the pages in it
 * survive, and its head may change around it.
 */
export function SplitView({
  end,
  endStands,
  onEndCollapse,
  paneKey,
  share = { atom: paneShareAtom, initial: PANE_DEFAULT_SHARE },
  start,
}: {
  end: SplitPane;
  /** Whether the end pane is put away, open beside the start pane, or the whole row. */
  endStands: "closed" | "fills" | "open";
  /** The end pane dragged shut past the point of keeping it. */
  onEndCollapse: () => void;
  /** Whose split this is: a change of key arrives at its state rather than sliding to it. */
  paneKey: string;
  /** Where the end pane's share of the row is kept, and what a double-click in the gap sets it back to. */
  share?: { atom: typeof paneShareAtom; initial: number };
  start: SplitPane;
}) {
  const fills = endStands === "fills";
  const isOpen = endStands === "open";
  const [storedShare, setStoredShare] = useAtom(share.atom);
  // Read so a zoom change re-runs the measure below, which a resize observer
  // cannot be relied on for.
  const zoom = useAtomValue(zoomAtom);
  const rowRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  // Read from the effects below without making it a dependency of the
  // open/close slide; the measure lists it on its own.
  const currentShare = useEffectEvent(() => storedShare);

  // The room the end pane takes in the row, the gap before it included, and
  // the pane's own width, which holds while the room closes so nothing
  // inside reflows on the way out.
  const reservedWidth = useMotionValue(0);
  const paneWidth = useMotionValue(0);
  const reservedRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  // The row's width, for the separator to report its range.
  const [rowWidth, setRowWidth] = useState(0);
  const animationsRef = useRef<AnimationPlaybackControls[]>([]);
  const stopAnimations = () => {
    for (const control of animationsRef.current) {
      control.stop();
    }
    animationsRef.current = [];
  };

  // Whether the end pane is shown at all: filling the row, or open beside
  // the start pane.
  const isShown = isOpen || fills;
  // The gap before the end pane, which a pane filling the row has none of.
  const gap = fills ? 0 : WINDOW_CARD_GAP;

  const shownKeyRef = useRef(paneKey);
  const isFirstRunRef = useRef(true);
  // Whether the pane was last sized against a row that had no width yet: a
  // row hidden while the pane mounted, or one not laid out. The next measure
  // that finds a width takes it, where a pane that is simply closed does not.
  const unmeasuredRef = useRef(false);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || draggingRef.current) {
      return;
    }
    // The row itself when the pane fills it, its share when open, and
    // nothing when closed.
    const width = fills
      ? row.offsetWidth
      : widthOfShare(currentShare(), row.offsetWidth);
    const reserved = fills
      ? row.offsetWidth
      : isOpen
        ? width + WINDOW_CARD_GAP
        : 0;
    const isNewKey = shownKeyRef.current !== paneKey;
    shownKeyRef.current = paneKey;
    if (isFirstRunRef.current || isNewKey || row.offsetWidth === 0) {
      isFirstRunRef.current = false;
      unmeasuredRef.current = row.offsetWidth === 0;
      reservedWidth.set(reserved);
      if (isShown) {
        paneWidth.set(width);
      }
      return;
    }
    if (isShown && reservedWidth.get() === 0) {
      paneWidth.set(width);
    }
    const controls = [animate(reservedWidth, reserved, RAIL_SLIDE_TRANSITION)];
    if (isShown) {
      controls.push(animate(paneWidth, width, RAIL_SLIDE_TRANSITION));
    }
    animationsRef.current = controls;
    return () => {
      for (const control of controls) {
        control.stop();
      }
      animationsRef.current = [];
    };
  }, [fills, isOpen, isShown, paneKey, paneWidth, reservedWidth]);

  // The share measured against the row again whenever either changes: the
  // window resized, the zoom changed, or the gap was dragged. Between those,
  // the end pane keeps the width it had and the start pane takes the
  // difference, so an end pane kept narrow stays narrow as the window or the
  // sidebar beside it changes; once the start pane is at its floor, the end
  // pane gives way.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    let keptPane: number | undefined;
    const widthFor = (width: number) => {
      keptPane ??= widthOfShare(currentShare(), width);
      return Math.min(
        Math.max(keptPane, PANE_WIDTH_MIN),
        widthOfShare(1, width),
      );
    };
    const measure = () => {
      setRowWidth(row.offsetWidth);
      if (draggingRef.current || !isShown) {
        return;
      }
      // Nothing reserved is the pane on its way open, whose slide the
      // measure must not cut short, unless it was never sized at all.
      if (reservedWidth.get() === 0 && !unmeasuredRef.current) {
        return;
      }
      if (row.offsetWidth === 0) {
        return;
      }
      const width = fills ? row.offsetWidth : widthFor(row.offsetWidth);
      unmeasuredRef.current = false;
      // Within a pixel is the same width worked out another way, and writing it
      // would snap a slide in progress to its end for a frame.
      if (Math.abs(width - paneWidth.get()) >= 1) {
        reservedWidth.set(width + gap);
        paneWidth.set(width);
        // Written here as well: motion draws a value on the next frame, and
        // this frame has already been laid out at the window's new width,
        // so it would paint with the start pane taking the difference and
        // then give it back, reflowing everything in it twice per frame.
        // Written from the observer, the layout settles before the paint.
        reservedRef.current?.style.setProperty("width", `${width + gap}px`);
        paneRef.current?.style.setProperty("width", `${width}px`);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [fills, gap, isShown, storedShare, zoom, paneWidth, reservedWidth]);

  const applyWidth = (width: number) => {
    reservedWidth.set(width + WINDOW_CARD_GAP);
    paneWidth.set(width);
  };
  const commit = (width: number, row: HTMLDivElement) => {
    const next = shareOfWidth(width, row.offsetWidth);
    applyWidth(widthOfShare(next, row.offsetWidth));
    setStoredShare(next);
  };

  return (
    <div className="flex h-full w-full" ref={rowRef}>
      <div className={cn("h-full min-w-0 flex-1", fills && "hidden")}>
        <PaneCard pane={start} />
      </div>
      <motion.div
        className="relative h-full shrink-0"
        ref={reservedRef}
        style={{ width: reservedWidth }}
      >
        {/* Clipped at the row's end, with room for the card's ring and
          shadow, so a pane on its way out leaves past the row's edge. */}
        <div className="relative h-full w-full overflow-clip [overflow-clip-margin:4px]">
          {/* Held at the pane's own width against the moving edge, so it slides
            in from the window's right and back out, the way the sidebar does,
            rather than being uncovered or narrowed. */}
          <motion.div
            aria-hidden={!isShown}
            className={cn(
              "absolute inset-y-0",
              !isShown && "pointer-events-none",
            )}
            ref={paneRef}
            style={{ left: gap, width: paneWidth }}
          >
            <PaneCard pane={end} />
          </motion.div>
        </div>
        {/* The gap between the cards is the handle. */}
        {isOpen && (
          <ResizeHandle
            // Measured from the row's end to the middle of the gap, where the
            // pointer stands on it, so the pane's edge stays put at the press.
            anchor={() => {
              const row = rowRef.current;
              if (!row || row.offsetWidth === 0) {
                return;
              }
              const rect = row.getBoundingClientRect();
              return (
                rect.right -
                (WINDOW_CARD_GAP / 2) * (rect.width / row.offsetWidth)
              );
            }}
            className="left-0"
            collapse={{
              below: PANE_COLLAPSE_THRESHOLD,
              // Dragged past the point of keeping it: the pane closes, and
              // the slide carries it the rest of the way.
              onCollapse: () => {
                draggingRef.current = false;
                onEndCollapse();
              },
            }}
            getWidth={() => paneWidth.get()}
            grows="left"
            label="Resize pane"
            max={widthOfShare(1, rowWidth)}
            min={PANE_WIDTH_MIN}
            onReset={() => {
              const row = rowRef.current;
              if (!row) {
                return;
              }
              stopAnimations();
              setStoredShare(share.initial);
              const width = widthOfShare(share.initial, row.offsetWidth);
              animationsRef.current = [
                animate(
                  reservedWidth,
                  width + WINDOW_CARD_GAP,
                  RAIL_SLIDE_TRANSITION,
                ),
                animate(paneWidth, width, RAIL_SLIDE_TRANSITION),
              ];
            }}
            onResize={(width) => {
              const row = rowRef.current;
              if (row) {
                applyWidth(
                  widthOfShare(
                    shareOfWidth(width, row.offsetWidth),
                    row.offsetWidth,
                  ),
                );
              }
            }}
            onResizeEnd={() => {
              draggingRef.current = false;
              const row = rowRef.current;
              if (row) {
                // The last width applied rather than one read off the event:
                // a cancel carries zeroed coordinates.
                commit(paneWidth.get(), row);
              }
            }}
            onResizeStart={() => {
              stopAnimations();
              draggingRef.current = true;
            }}
            value={widthOfShare(storedShare, rowWidth)}
          />
        )}
      </motion.div>
    </div>
  );
}

/** A pane as a card of the window's, its head over its body. */
function PaneCard({ pane }: { pane: SplitPane }) {
  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col", WINDOW_CARD)}>
      {pane.head}
      <div className="relative min-h-0 flex-1">{pane.body}</div>
    </div>
  );
}
