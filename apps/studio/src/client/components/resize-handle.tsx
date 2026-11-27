import { cn } from "@/client/lib/utils";
import { useEffect, useRef, useState } from "react";

const KEYBOARD_STEP = 16;
/** How long the pointer rests in a gap before its grip shows. */
const GRIP_DELAY_MS = 200;
/** The grip's height in layout px (`h-9`). */
const GRIP_HEIGHT = 36;

/**
 * The edge a column or pane is resized by. It owns the gesture and nothing
 * else: what the width is, how it is clamped, animated and kept is the
 * caller's, handed a width the pointer or keyboard is asking for.
 *
 * - A drag holds pointer capture, and ends the same way whether the pointer
 *   is released, canceled, or loses capture without either arriving, so the
 *   handle never follows a pointer merely passing over it afterwards.
 * - Widths are layout px: the pointer's travel is divided by the zoom the
 *   handle is under, read per move since it can change mid-drag.
 * - Dragged under `collapse.below`, the drag lets go and the caller closes
 *   what it resizes.
 * - Double-click resets; with a `label`, it is a focusable WAI-ARIA window
 *   splitter whose arrows step and whose Home/End jump to the bounds.
 * - An edge that is a border (`variant: "line"`) shows a 2px line down its
 *   length on hover. A gap between cards (`"grip"`) shows a short grip where
 *   the pointer has rested for `GRIP_DELAY_MS`, which stays at that height
 *   until the pointer leaves the gap, through a drag and its release, so it
 *   never chases the pointer. The whole handle takes the drag either way.
 *
 * The callbacks a drag started with are the ones it calls throughout, so
 * what they close over is the state at the press.
 */
export function ResizeHandle({
  anchor,
  className,
  collapse,
  getWidth,
  grows,
  label,
  max,
  min,
  onReset,
  onResize,
  onResizeEnd,
  onResizeStart,
  value,
  variant = "line",
}: {
  /**
   * The client x of the edge that stays put, to measure the width from it;
   * otherwise the width moves by the pointer's travel from the press.
   */
  anchor?: () => number | undefined;
  /** Where the handle sits; it is absolutely positioned, full height. */
  className?: string;
  collapse?: { below: number; onCollapse: () => void };
  /** The width as it stands, read when a drag or a key press starts. */
  getWidth: () => number;
  /** Which way the pointer moves to widen. */
  grows: "left" | "right";
  /** Names the splitter; without one it is pointer-only and hidden from assistive tech. */
  label?: string;
  max?: number;
  min?: number;
  onReset?: () => void;
  /** An unclamped width asked for. */
  onResize: (width: number) => void;
  /** A drag or key press is over and did not let go early: keep what was applied. */
  onResizeEnd?: () => void;
  /** Before the first width: the moment to stop whatever animates it. */
  onResizeStart?: () => void;
  value?: number;
  variant?: "grip" | "line";
}) {
  const toward = grows === "right" ? 1 : -1;
  const isGrip = variant === "grip";
  /** Where the grip stands, in layout px from the handle's top; kept while it fades out. */
  const [grip, setGrip] = useState<{ isShown: boolean; y: number } | null>(
    null,
  );
  const gripTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(gripTimer.current), []);

  /** The pointer's height on the handle in layout px, clamped so the grip stays whole. */
  function gripYAt(event: React.PointerEvent<HTMLDivElement>) {
    const handle = event.currentTarget;
    const rect = handle.getBoundingClientRect();
    const zoom = handle.offsetHeight > 0 ? rect.height / handle.offsetHeight : 1;
    const y = (event.clientY - rect.top) / zoom;
    return Math.min(
      Math.max(y, GRIP_HEIGHT / 2),
      Math.max(handle.offsetHeight - GRIP_HEIGHT / 2, GRIP_HEIGHT / 2),
    );
  }

  /** Until the grip shows, each move starts the rest over at the pointer's height. */
  function handleGripRest(event: React.PointerEvent<HTMLDivElement>) {
    if (grip?.isShown) {
      return;
    }
    const y = gripYAt(event);
    clearTimeout(gripTimer.current);
    gripTimer.current = setTimeout(() => {
      setGrip({ isShown: true, y });
    }, GRIP_DELAY_MS);
  }

  // Pointer capture holds the pointer over the handle for a drag, so this
  // comes after a release away from it, never during the drag.
  function handleGripLeave() {
    clearTimeout(gripTimer.current);
    setGrip((shown) => shown && { ...shown, isShown: false });
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (isGrip && !grip?.isShown) {
      clearTimeout(gripTimer.current);
      setGrip({ isShown: true, y: gripYAt(event) });
    }
    const handle = event.currentTarget;
    const { clientX: startX, pointerId } = event;
    onResizeStart?.();
    const startWidth = getWidth();
    handle.setPointerCapture(pointerId);

    const listeners = new AbortController();
    const endDrag = () => {
      listeners.abort();
      if (handle.hasPointerCapture(pointerId)) {
        handle.releasePointerCapture(pointerId);
      }
    };

    const widthAt = (clientX: number) => {
      // On-screen px over layout px: the zoom this handle is under.
      const zoom =
        handle.offsetWidth > 0
          ? handle.getBoundingClientRect().width / handle.offsetWidth
          : 1;
      const from = anchor?.();
      return from === undefined
        ? startWidth + (toward * (clientX - startX)) / zoom
        : (toward * (clientX - from)) / zoom;
    };

    const handleMove = (move: PointerEvent) => {
      if (move.pointerId !== pointerId) {
        return;
      }
      const width = widthAt(move.clientX);
      if (collapse && width < collapse.below) {
        endDrag();
        collapse.onCollapse();
        return;
      }
      onResize(width);
    };

    // Ends the drag once: releasing capture raises `lostpointercapture`
    // after the listeners are already gone.
    const handleUp = () => {
      endDrag();
      onResizeEnd?.();
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
    // Capture can end without a pointerup ever arriving: the element is
    // replaced, the window loses the device, the OS takes the gesture.
    handle.addEventListener("lostpointercapture", handleUp, {
      signal: listeners.signal,
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = (() => {
      switch (event.key) {
        case "ArrowLeft": {
          return getWidth() - toward * KEYBOARD_STEP;
        }
        case "ArrowRight": {
          return getWidth() + toward * KEYBOARD_STEP;
        }
        case "End": {
          return max ?? Number.POSITIVE_INFINITY;
        }
        case "Home": {
          return min ?? 0;
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
    onResizeStart?.();
    onResize(next);
    onResizeEnd?.();
  }

  return (
    <div
      {...(label
        ? {
            "aria-label": label,
            "aria-orientation": "vertical",
            "aria-valuemax": max,
            "aria-valuemin": min,
            "aria-valuenow": value,
            onKeyDown: handleKeyDown,
            role: "separator",
            tabIndex: 0,
          }
        : { "aria-hidden": true })}
      className={cn(
        "group absolute inset-y-0 z-20 w-2 cursor-col-resize outline-hidden select-none",
        !isGrip &&
          "after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent hover:after:bg-muted-foreground/15 focus-visible:after:bg-ring active:after:bg-resize-held",
        className,
      )}
      onDoubleClick={onReset}
      onPointerDown={handlePointerDown}
      {...(isGrip
        ? {
            onPointerEnter: handleGripRest,
            onPointerLeave: handleGripLeave,
            onPointerMove: handleGripRest,
          }
        : {})}
    >
      {isGrip && (
        // Centered on the handle, or as far off it as `--grip-nudge` says,
        // for a gap a focus outline takes one side of.
        <span
          className={cn(
            "pointer-events-none absolute left-[calc(50%+var(--grip-nudge,0px))] h-9 w-1 -translate-1/2 rounded-full bg-muted-foreground/60 opacity-0 transition-opacity duration-200 ease-out",
            "group-focus-visible:bg-ring group-focus-visible:opacity-100 group-active:bg-foreground/70",
            grip?.isShown && "opacity-100 duration-150",
          )}
          style={{ top: grip ? grip.y : "50%" }}
        />
      )}
    </div>
  );
}
