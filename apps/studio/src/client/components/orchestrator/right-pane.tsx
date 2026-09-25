import { orchestratorPaneShareAtom } from "@/client/atoms/orchestrator";
import {
  TASK_PANE_COLLAPSE_THRESHOLD,
  TASK_PANE_DEFAULT_SHARE,
  TASK_PANE_WIDTH_MIN,
  taskPaneShare,
  taskPaneWidth,
} from "@/client/atoms/task-pane";
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
  useLayoutEffect,
  useRef,
  useState,
} from "react";

/**
 * The conversation and the pane of tabs beside it, the way a task's page
 * keeps its pane: the conversation flexes and the pane is sized, so a drag
 * at their edge is one number, and opening or closing the pane slides it in
 * or out at its width rather than squeezing what it holds. What the pane
 * holds stays mounted while it is closed, since the pages in it are guests
 * that would be lost with it; it is only clipped away.
 *
 * What is kept is a share of the row, re-measured whenever the row changes,
 * the window's zoom included; see the task pane's atom for why.
 *
 * Told to fill, the pane is the row: the conversation is put away and the
 * pane takes the whole width with no edge to drag, which is how a place of
 * tabs stands with nothing beside it. What the pane holds stays where it is
 * in the tree either way, so the pages in it survive the switch.
 */
export function RightPane({
  children,
  conversation,
  fills = false,
  isOpen,
  onCollapse,
  paneKey,
}: {
  children: ReactNode;
  conversation: ReactNode;
  /** Whether the pane has the whole row, with the conversation put away. */
  fills?: boolean;
  isOpen: boolean;
  /** Dragged shut past the point of keeping it. */
  onCollapse: () => void;
  /** Whose pane this is: a change of group arrives at its state rather than sliding to it. */
  paneKey: string;
}) {
  const [storedShare, setStoredShare] = useAtom(orchestratorPaneShareAtom);
  // Read so a zoom change re-runs the measure below, which a resize observer
  // cannot be relied on for.
  const zoom = useAtomValue(zoomAtom);
  const rowRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const shareRef = useRef(storedShare);
  useEffect(() => {
    shareRef.current = storedShare;
  }, [storedShare]);

  // The room the pane takes in the row, and the pane's own width, which
  // holds while the room closes so nothing inside reflows on the way out.
  const reservedWidth = useMotionValue(0);
  const paneWidth = useMotionValue(0);
  // The row's width, for the separator to report its range.
  const [rowWidth, setRowWidth] = useState(0);
  const animationsRef = useRef<AnimationPlaybackControls[]>([]);
  const stopAnimations = () => {
    for (const control of animationsRef.current) {
      control.stop();
    }
    animationsRef.current = [];
  };

  // Whether the pane is shown at all: filling the row, or open beside the
  // conversation.
  const isShown = isOpen || fills;

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
    const target = fills
      ? row.offsetWidth
      : isOpen
        ? taskPaneWidth(shareRef.current, row.offsetWidth)
        : 0;
    const isNewKey = shownKeyRef.current !== paneKey;
    shownKeyRef.current = paneKey;
    if (isFirstRunRef.current || isNewKey || row.offsetWidth === 0) {
      isFirstRunRef.current = false;
      unmeasuredRef.current = row.offsetWidth === 0;
      reservedWidth.set(target);
      if (isShown) {
        paneWidth.set(target);
      }
      return;
    }
    if (isShown && reservedWidth.get() === 0) {
      paneWidth.set(target);
    }
    const controls = [animate(reservedWidth, target, RAIL_SLIDE_TRANSITION)];
    if (isShown) {
      controls.push(animate(paneWidth, target, RAIL_SLIDE_TRANSITION));
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
  // window resized, the zoom changed, or the handle was moved.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
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
      const width = fills
        ? row.offsetWidth
        : taskPaneWidth(shareRef.current, row.offsetWidth);
      unmeasuredRef.current = false;
      if (width !== paneWidth.get()) {
        reservedWidth.set(width);
        paneWidth.set(width);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, [fills, isShown, storedShare, zoom, paneWidth, reservedWidth]);

  const applyWidth = (width: number) => {
    reservedWidth.set(width);
    paneWidth.set(width);
  };
  const commit = (width: number, row: HTMLDivElement) => {
    const share = taskPaneShare(width, row.offsetWidth);
    applyWidth(taskPaneWidth(share, row.offsetWidth));
    setStoredShare(share);
  };

  return (
    <div className="flex h-full w-full overflow-hidden" ref={rowRef}>
      <div className={cn("h-full min-w-0 flex-1", fills && "hidden")}>
        {conversation}
      </div>
      <motion.div
        className="relative h-full shrink-0"
        style={{ width: reservedWidth }}
      >
        <div className="relative h-full w-full overflow-hidden">
          {/* Held at the pane's own width against the row's right edge, so
            closing clips it away from the left rather than narrowing it. */}
          <motion.div
            aria-hidden={!isShown}
            className={cn(
              "absolute inset-y-0 right-0",
              !isShown && "pointer-events-none",
            )}
            style={{ width: paneWidth }}
          >
            {children}
          </motion.div>
        </div>
        {isOpen && !fills && (
          <ResizeHandle
            anchor={() => rowRef.current?.getBoundingClientRect().right}
            className="left-0 -translate-x-1/2"
            collapse={{
              below: TASK_PANE_COLLAPSE_THRESHOLD,
              // Dragged past the point of keeping it: the pane closes, and
              // the slide carries it the rest of the way.
              onCollapse: () => {
                draggingRef.current = false;
                onCollapse();
              },
            }}
            getWidth={() => paneWidth.get()}
            grows="left"
            label="Resize pane"
            max={taskPaneWidth(1, rowWidth)}
            min={TASK_PANE_WIDTH_MIN}
            onReset={() => {
              const row = rowRef.current;
              if (!row) {
                return;
              }
              stopAnimations();
              setStoredShare(TASK_PANE_DEFAULT_SHARE);
              const width = taskPaneWidth(
                TASK_PANE_DEFAULT_SHARE,
                row.offsetWidth,
              );
              animationsRef.current = [
                animate(reservedWidth, width, RAIL_SLIDE_TRANSITION),
                animate(paneWidth, width, RAIL_SLIDE_TRANSITION),
              ];
            }}
            onResize={(width) => {
              const row = rowRef.current;
              if (row) {
                applyWidth(
                  taskPaneWidth(
                    taskPaneShare(width, row.offsetWidth),
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
            value={taskPaneWidth(storedShare, rowWidth)}
            variant="grip"
          />
        )}
      </motion.div>
    </div>
  );
}
