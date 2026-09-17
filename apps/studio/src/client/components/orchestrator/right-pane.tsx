import { orchestratorPaneShareAtom } from "@/client/atoms/orchestrator";
import {
  TASK_PANE_COLLAPSE_THRESHOLD,
  TASK_PANE_DEFAULT_SHARE,
  TASK_PANE_WIDTH_MIN,
  taskPaneShare,
  taskPaneWidth,
} from "@/client/atoms/task-pane";
import { zoomAtom } from "@/client/atoms/zoom";
import { RAIL_SLIDE_TRANSITION } from "@/client/lib/rail-motion";
import { cn } from "@/client/lib/utils";
import { useAtom, useAtomValue } from "jotai";
import {
  animate,
  type AnimationPlaybackControls,
  motion,
  useMotionValue,
} from "motion/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";

const KEYBOARD_STEP = 16;

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
 */
export function RightPane({
  children,
  conversation,
  isOpen,
  onCollapse,
  paneKey,
}: {
  children: ReactNode;
  conversation: ReactNode;
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
  const animationsRef = useRef<AnimationPlaybackControls[]>([]);
  const stopAnimations = () => {
    for (const control of animationsRef.current) {
      control.stop();
    }
    animationsRef.current = [];
  };

  const shownKeyRef = useRef(paneKey);
  const isFirstRunRef = useRef(true);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || draggingRef.current) {
      return;
    }
    const target = isOpen
      ? taskPaneWidth(shareRef.current, row.offsetWidth)
      : 0;
    const isNewKey = shownKeyRef.current !== paneKey;
    shownKeyRef.current = paneKey;
    if (isFirstRunRef.current || isNewKey || row.offsetWidth === 0) {
      isFirstRunRef.current = false;
      reservedWidth.set(target);
      if (isOpen) {
        paneWidth.set(target);
      }
      return;
    }
    if (isOpen && reservedWidth.get() === 0) {
      paneWidth.set(target);
    }
    const controls = [animate(reservedWidth, target, RAIL_SLIDE_TRANSITION)];
    if (isOpen) {
      controls.push(animate(paneWidth, target, RAIL_SLIDE_TRANSITION));
    }
    animationsRef.current = controls;
    return () => {
      for (const control of controls) {
        control.stop();
      }
      animationsRef.current = [];
    };
  }, [isOpen, paneKey, paneWidth, reservedWidth]);

  // The share measured against the row again whenever either changes: the
  // window resized, the zoom changed, or the handle was moved.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const measure = () => {
      if (draggingRef.current || !isOpen || reservedWidth.get() === 0) {
        return;
      }
      const width = taskPaneWidth(shareRef.current, row.offsetWidth);
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
  }, [isOpen, storedShare, zoom, paneWidth, reservedWidth]);

  // The width the pointer asks for, in the row's own layout px: the rect is
  // on-screen px and `offsetWidth` layout px, so their ratio is the zoom.
  const widthAt = (row: HTMLDivElement, clientX: number) => {
    const rect = row.getBoundingClientRect();
    return (rect.right - clientX) / (rect.width / row.offsetWidth);
  };
  const applyWidth = (width: number) => {
    reservedWidth.set(width);
    paneWidth.set(width);
  };
  const commit = (width: number, row: HTMLDivElement) => {
    const share = taskPaneShare(width, row.offsetWidth);
    applyWidth(taskPaneWidth(share, row.offsetWidth));
    setStoredShare(share);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const next = (() => {
      switch (event.key) {
        // The pane is on the trailing edge, so left grows it.
        case "ArrowLeft": {
          return paneWidth.get() + KEYBOARD_STEP;
        }
        case "ArrowRight": {
          return paneWidth.get() - KEYBOARD_STEP;
        }
        case "End": {
          return row.offsetWidth;
        }
        case "Home": {
          return TASK_PANE_WIDTH_MIN;
        }
        default: {
          return;
        }
      }
    })();
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    stopAnimations();
    commit(next, row);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const row = rowRef.current;
    if (event.button !== 0 || !row) {
      return;
    }
    event.preventDefault();
    const handle = event.currentTarget;
    const { pointerId } = event;
    stopAnimations();
    handle.setPointerCapture(pointerId);
    draggingRef.current = true;
    let collapsed = false;
    const listeners = new AbortController();
    const endDrag = () => {
      draggingRef.current = false;
      listeners.abort();
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    };
    const handleMove = (move: PointerEvent) => {
      if (!draggingRef.current) {
        return;
      }
      const width = widthAt(row, move.clientX);
      // Dragged past the point of keeping it: the pane closes, and the slide
      // carries it the rest of the way.
      if (width < TASK_PANE_COLLAPSE_THRESHOLD) {
        collapsed = true;
        endDrag();
        onCollapse();
        return;
      }
      applyWidth(
        taskPaneWidth(taskPaneShare(width, row.offsetWidth), row.offsetWidth),
      );
    };
    const handleUp = () => {
      endDrag();
      if (!collapsed) {
        // The last width the drag applied rather than one read off the event:
        // a cancel carries zeroed coordinates.
        commit(paneWidth.get(), row);
      }
    };
    handle.addEventListener("pointermove", handleMove, {
      signal: listeners.signal,
    });
    handle.addEventListener("pointerup", handleUp, {
      signal: listeners.signal,
    });
    handle.addEventListener("pointercancel", handleUp, {
      signal: listeners.signal,
    });
    handle.addEventListener("lostpointercapture", handleUp, {
      signal: listeners.signal,
    });
  };

  return (
    <div className="flex h-full w-full overflow-hidden" ref={rowRef}>
      <div className="h-full min-w-0 flex-1">{conversation}</div>
      <motion.div
        className="relative h-full shrink-0"
        style={{ width: reservedWidth }}
      >
        <div className="relative h-full w-full overflow-hidden">
          {/* Held at the pane's own width against the row's right edge, so
            closing clips it away from the left rather than narrowing it. */}
          <motion.div
            aria-hidden={!isOpen}
            className={cn(
              "absolute inset-y-0 right-0",
              !isOpen && "pointer-events-none",
            )}
            style={{ width: paneWidth }}
          >
            {children}
          </motion.div>
        </div>
        {isOpen && (
          <div
            aria-label="Resize pane"
            aria-orientation="vertical"
            aria-valuemin={TASK_PANE_WIDTH_MIN}
            className={cn(
              "absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize select-none",
              "after:absolute after:top-1/2 after:left-1/2 after:h-10 after:w-1 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full after:bg-transparent after:transition-colors after:duration-150",
              "outline-hidden hover:after:bg-muted-foreground/40 focus-visible:after:bg-ring active:after:bg-primary/60",
            )}
            onDoubleClick={() => {
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
            onKeyDown={handleKeyDown}
            onPointerDown={handlePointerDown}
            role="separator"
            tabIndex={0}
          />
        )}
      </motion.div>
    </div>
  );
}
