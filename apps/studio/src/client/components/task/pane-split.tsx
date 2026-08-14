import {
  TASK_PANE_COLLAPSE_THRESHOLD,
  TASK_PANE_DEFAULT_SHARE,
  TASK_PANE_WIDTH_MIN,
  taskPaneShare,
  taskPaneShareAtom,
  taskPaneWidth,
} from "@/client/atoms/task-pane";
import { zoomAtom } from "@/client/atoms/zoom";
import {
  RAIL_FADE_TRANSITION,
  RAIL_SLIDE_TRANSITION,
} from "@/client/lib/rail-motion";
import { cn } from "@/client/lib/utils";
import { type TaskId } from "@instrument-org/workspace/client";
import { useAtomValue, useSetAtom } from "jotai";
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

const KEYBOARD_STEP = 16;

/**
 * The task's two columns: the chat, and the pane that opens beside it.
 *
 * The mirror of the studio sidebar rail, and for the same reason. The chat
 * flexes and the pane is sized, so the row is one number: give the pane a width
 * and the browser gives the chat the rest. Width is driven imperatively so a
 * drag tracks the cursor 1:1 with no transition, and open/close is a slide --
 * the pane keeps its width and translates out through a clip while the space it
 * reserves animates alongside, so its contents never reflow on the way out.
 *
 * That last part is what the pane needs and a general layout engine cannot
 * offer: the browser tab paints a `<webview>` over a measured slot, and a slot
 * whose width changes 60 times is 60 guest resizes. Sliding at a fixed width is
 * a reposition.
 *
 * What is stored is a share of the row (see the atom). What is applied is a
 * width, recomputed from that share whenever the row changes size -- including
 * when the window zoom changes, which resizes every row in the app without
 * anything being resized.
 *
 * - `reservedWidth`: space the pane takes in the row (0 when closed).
 * - `paneWidth`: the pane's own width; follows the drag but stays put while
 *   sliding out, which is what prevents the squish.
 * - `paneX`: how far the pane is translated out of its clip.
 *
 * `children` is a function because the pane's contents need to know a slide is
 * running: see `useBrowserSlot`.
 */
export function TaskPaneSplit({
  chat,
  children,
  isPaneOpen,
  onCollapse,
  taskId,
}: {
  chat: ReactNode;
  children: (state: { isSliding: boolean }) => ReactNode;
  isPaneOpen: boolean;
  // Dragged shut. The pane's open state lives beside the task rather than here,
  // so closing it is the host's call to make.
  onCollapse: () => void;
  // Which task's pane this is. The route reuses one instance of this across
  // tasks, so without it a task whose pane differs from the last one's reads as
  // that pane opening or closing.
  taskId: TaskId;
}) {
  const storedShare = useAtomValue(taskPaneShareAtom);
  const setStoredShare = useSetAtom(taskPaneShareAtom);
  // Not used for any measurement -- the ratio below is more accurate and always
  // current. Read so that a zoom change re-runs the effect that re-applies the
  // share, which is the one thing a resize observer cannot be relied on for.
  const zoom = useAtomValue(zoomAtom);

  const rowRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const collapsingRef = useRef(false);

  const reservedWidth = useMotionValue(0);
  const paneWidth = useMotionValue(0);
  const paneX = useMotionValue(0);
  const opacity = useMotionValue(isPaneOpen ? 1 : 0);

  // The pane stays rendered until the close finishes. Open is task state and
  // the click that writes it paints optimistically, so without this the pane
  // would be gone in the same frame the user asks for it, with nothing left to
  // animate.
  const [isMounted, setIsMounted] = useState(isPaneOpen);
  const [isSliding, setIsSliding] = useState(false);
  if (isPaneOpen && !isMounted) {
    setIsMounted(true);
  }

  // Read the latest share from inside the effects without making it a
  // dependency: a drag applies its own width directly, so re-running the spring
  // on every change of it would fight the drag and jitter.
  const shareRef = useRef(storedShare);
  useEffect(() => {
    shareRef.current = storedShare;
  }, [storedShare]);

  const applyWidth = (width: number) => {
    reservedWidth.set(width);
    paneWidth.set(width);
    paneX.set(0);
  };

  // Whatever is currently driving those values, so an interaction can take them
  // back. `set` changes a motion value without canceling its animation, so a
  // spring still running writes over every frame a drag applies -- the pane
  // ignores the pointer, and the width committed on pointerup is one the spring
  // then overwrites on its way to the old target. The handle is on screen for
  // the whole of an opening slide, so that window is reachable by hand.
  const widthAnimationsRef = useRef<AnimationPlaybackControls[]>([]);

  function stopWidthAnimations() {
    for (const control of widthAnimationsRef.current) {
      control.stop();
    }
    widthAnimationsRef.current = [];
    // Only reachable while the pane is open, so a half-played fade is finished
    // rather than left at whatever the interrupted slide had reached.
    opacity.set(1);
    // Nothing is sliding now, so the browser slot can stop following the pane
    // every frame. A drag changes the slot's size, which its resize observer
    // sees on its own.
    setIsSliding(false);
  }

  // A task opened with its pane already open is not an opening: it starts at
  // the width and stays there. Same for the task after it, since switching
  // tasks in the sidebar keeps this instance and only changes what it is
  // showing -- the pane of the task being left is not closing, and the pane of
  // the one being arrived at was already open when it got there.
  const isFirstRunRef = useRef(true);
  const shownTaskRef = useRef(taskId);

  // Slide the pane in and out when the open state flips. Width changes while
  // open are driven by their own handlers, so this only reacts to open/close.
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || draggingRef.current) {
      return;
    }

    const target = taskPaneWidth(shareRef.current, row.offsetWidth);

    // Set rather than applied: `applyWidth` is rebuilt every render, and
    // depending on it here would restart the spring on every one.
    const settle = () => {
      if (isPaneOpen) {
        reservedWidth.set(target);
        paneWidth.set(target);
        paneX.set(0);
        opacity.set(1);
      } else {
        reservedWidth.set(0);
        opacity.set(0);
        setIsMounted(false);
      }
    };

    const isNewTask = shownTaskRef.current !== taskId;
    shownTaskRef.current = taskId;

    // Arriving at a state rather than watching it happen: the first run, a
    // task change, or a row measuring nothing -- that last one is a task
    // mounted behind another, where a slide animates what nobody is looking at
    // and holds the browser slot's per-frame tracking open for it.
    if (isFirstRunRef.current || isNewTask || row.offsetWidth === 0) {
      isFirstRunRef.current = false;
      settle();
      return;
    }

    setIsSliding(true);

    const controls: AnimationPlaybackControls[] = [];
    if (isPaneOpen) {
      // Only when genuinely closed (nothing reserved) pre-size the pane, so it
      // slides in at full width instead of growing from nothing. Reopening
      // mid-close leaves it wherever the close had got to.
      if (reservedWidth.get() === 0) {
        paneWidth.set(target);
        paneX.set(target);
      }
      controls.push(
        animate(reservedWidth, target, RAIL_SLIDE_TRANSITION),
        animate(paneWidth, target, RAIL_SLIDE_TRANSITION),
        animate(paneX, 0, {
          ...RAIL_SLIDE_TRANSITION,
          onComplete: () => {
            setIsSliding(false);
          },
        }),
        animate(opacity, 1, RAIL_FADE_TRANSITION),
      );
    } else {
      controls.push(
        animate(reservedWidth, 0, {
          ...RAIL_SLIDE_TRANSITION,
          onComplete: () => {
            setIsSliding(false);
            setIsMounted(false);
          },
        }),
        animate(paneX, paneWidth.get(), RAIL_SLIDE_TRANSITION),
        animate(opacity, 0, RAIL_FADE_TRANSITION),
      );
    }
    widthAnimationsRef.current = controls;
    return () => {
      for (const control of controls) {
        control.stop();
      }
      widthAnimationsRef.current = [];
    };
  }, [isPaneOpen, taskId, opacity, paneWidth, paneX, reservedWidth]);

  // The row's own width, tracked as state so the separator can report its range
  // and so the re-apply below has something to react to.
  const [rowWidth, setRowWidth] = useState(0);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    setRowWidth(row.offsetWidth);
    const observer = new ResizeObserver(() => {
      setRowWidth(row.offsetWidth);
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Measure the share against the row again whenever either changes.
  //
  // The row changes on a window resize, and on a zoom change -- the one that
  // matters, because it redefines the pixel every stored width was written in,
  // and it does not always reach a resize observer.
  //
  // The share changes when another pane is resized. Every task tab stays
  // mounted while it is in the background and they all read the one share, so
  // without this a tab resized in one tab keeps its old width in the others,
  // while storage and its own reported value have already moved on.
  useEffect(() => {
    const row = rowRef.current;
    // Reserving nothing means the pane is closed or on its way out, and
    // widening it from here would put it back on screen.
    if (!row || draggingRef.current || reservedWidth.get() === 0) {
      return;
    }
    const width = taskPaneWidth(storedShare, row.offsetWidth);
    if (width !== paneWidth.get()) {
      reservedWidth.set(width);
      paneWidth.set(width);
    }
  }, [rowWidth, storedShare, zoom, paneWidth, reservedWidth]);

  // The width the pointer is asking for, in the row's own layout pixels.
  // `getBoundingClientRect` is on-screen pixels and `offsetWidth` is layout
  // pixels, so their ratio is the zoom this row is actually under -- read per
  // move rather than captured, because it can change mid-drag.
  function widthAt(row: HTMLDivElement, clientX: number) {
    const rect = row.getBoundingClientRect();
    if (row.offsetWidth <= 0) {
      return;
    }
    return (rect.right - clientX) / (rect.width / row.offsetWidth);
  }

  // Keyboard resize for the splitter (WAI-ARIA window-splitter pattern): arrows
  // nudge a step, Home/End jump to the bounds. Base each step off the live pane
  // width, not the render-time atom, so repeated presses accumulate.
  function nextKeyboardWidth(key: string, row: number): number | undefined {
    switch (key) {
      // The pane is on the trailing edge, so left grows it and right shrinks it.
      case "ArrowLeft": {
        return taskPaneWidth(
          taskPaneShare(paneWidth.get() + KEYBOARD_STEP, row),
          row,
        );
      }
      case "ArrowRight": {
        return taskPaneWidth(
          taskPaneShare(paneWidth.get() - KEYBOARD_STEP, row),
          row,
        );
      }
      case "End": {
        return taskPaneWidth(1, row);
      }
      case "Home": {
        return TASK_PANE_WIDTH_MIN;
      }
      default: {
        return undefined;
      }
    }
  }

  function commit(width: number, row: HTMLDivElement) {
    applyWidth(width);
    setStoredShare(taskPaneShare(width, row.offsetWidth));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    const next = nextKeyboardWidth(event.key, row.offsetWidth);
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    stopWidthAnimations();
    commit(next, row);
  }

  function handleDoubleClick() {
    const row = rowRef.current;
    if (!row) {
      return;
    }
    stopWidthAnimations();
    const width = taskPaneWidth(TASK_PANE_DEFAULT_SHARE, row.offsetWidth);
    setStoredShare(TASK_PANE_DEFAULT_SHARE);
    // Tracked like the slide's own, so a drag that starts while this is still
    // springing takes the values back from it.
    widthAnimationsRef.current = [
      animate(reservedWidth, width, RAIL_SLIDE_TRANSITION),
      animate(paneWidth, width, RAIL_SLIDE_TRANSITION),
    ];
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();

    const handle = event.currentTarget;
    const { pointerId } = event;
    const row = rowRef.current;
    if (!row) {
      return;
    }
    stopWidthAnimations();
    handle.setPointerCapture(pointerId);
    draggingRef.current = true;
    collapsingRef.current = false;

    const listeners = new AbortController();
    const endDrag = () => {
      draggingRef.current = false;
      listeners.abort();
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    };

    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId || !draggingRef.current) {
        return;
      }
      const width = widthAt(row, moveEvent.clientX);
      if (width === undefined) {
        return;
      }
      // Dragged past the point of keeping it: close, and let the open/close
      // slide carry it the rest of the way from wherever the drag left it.
      if (width < TASK_PANE_COLLAPSE_THRESHOLD) {
        collapsingRef.current = true;
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
      if (collapsingRef.current) {
        return;
      }
      // Commit the last width the drag applied, not one recomputed from the
      // event: pointercancel carries zeroed coordinates, which would persist
      // the maximum width regardless of where the drag actually ended.
      commit(
        taskPaneWidth(
          taskPaneShare(paneWidth.get(), row.offsetWidth),
          row.offsetWidth,
        ),
        row,
      );
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
    // Capture can end without a pointerup ever arriving -- the element is
    // replaced, the window loses the device, the OS takes the gesture. Ending
    // the same way keeps two things true: the move listener does not outlive
    // the drag, so the pane cannot follow a pointer merely passing over the
    // handle, and the width the drag reached is still the width that gets
    // kept. Releasing the pointer also raises this, after `handleUp` has
    // already torn the listeners down, so it runs once either way.
    handle.addEventListener("lostpointercapture", handleUp, {
      signal: listeners.signal,
    });
  }

  return (
    <div className="flex h-full w-full overflow-hidden" ref={rowRef}>
      <div className="h-full min-w-0 flex-1">{chat}</div>

      <motion.div
        className="relative h-full shrink-0"
        style={{ opacity, width: reservedWidth }}
      >
        <div className="relative h-full w-full overflow-hidden">
          {/* Nothing inside takes a click while it is moving. A tab strip
              sliding under the cursor puts a different tab where the last one
              was, so a second click of a quick double lands on whichever one
              arrived, which is never what was aimed at. */}
          <motion.div
            className={cn(
              "absolute inset-y-0 right-0",
              isSliding && "pointer-events-none",
            )}
            style={{ width: paneWidth, x: paneX }}
          >
            {isMounted && children({ isSliding })}
          </motion.div>
        </div>

        {isPaneOpen && (
          // Full height to grab, but the mark itself is a short centered
          // grip rather than the sidebar's hairline: this edge sits between two
          // cards rather than against the window, and a rule the height of the
          // app reads as a border somebody drew.
          <div
            aria-label="Resize pane"
            aria-orientation="vertical"
            aria-valuemax={taskPaneWidth(1, rowWidth)}
            aria-valuemin={TASK_PANE_WIDTH_MIN}
            aria-valuenow={taskPaneWidth(storedShare, rowWidth)}
            className={cn(
              "group/pane-handle absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize select-none",
              "after:absolute after:top-1/2 after:left-1/2 after:h-10 after:w-1 after:-translate-x-1/2 after:-translate-y-1/2 after:rounded-full",
              "after:bg-transparent after:transition-colors after:duration-150",
              "hover:after:bg-muted-foreground/40 active:after:bg-primary/60",
            )}
            onDoubleClick={handleDoubleClick}
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
