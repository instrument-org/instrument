import { cn } from "@/client/lib/utils";

const KEYBOARD_STEP = 16;

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
 *   what it resizes; `onResize` calling its `release` lets go the same way.
 * - Double-click resets; with a `label`, it is a focusable WAI-ARIA window
 *   splitter whose arrows step and whose Home/End jump to the bounds.
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
  variant = "hairline",
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
  /** An unclamped width asked for; `release` ends the drag without `onResizeEnd`. */
  onResize: (width: number, release: () => void) => void;
  /** A drag or key press is over and did not let go early: keep what was applied. */
  onResizeEnd?: () => void;
  /** Before the first width: the moment to stop whatever animates it. */
  onResizeStart?: () => void;
  value?: number;
  /** A full-height hairline for an edge against a surface, a short grip for one between two cards. */
  variant?: "grip" | "hairline";
}) {
  const toward = grows === "right" ? 1 : -1;

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
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
      onResize(width, endDrag);
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
    const press = { released: false };
    onResize(next, () => {
      press.released = true;
    });
    if (!press.released) {
      onResizeEnd?.();
    }
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
        "absolute inset-y-0 z-20 cursor-col-resize outline-hidden select-none",
        "after:absolute after:left-1/2 after:-translate-x-1/2 after:bg-transparent",
        variant === "hairline"
          ? "w-2 after:inset-y-0 after:w-px hover:after:bg-muted-foreground/40 focus-visible:after:w-0.5 focus-visible:after:bg-ring active:after:bg-primary/50"
          : // The grip takes the focus mark: an outline would ring the whole
            // grab strip, which is the height of the pane and reads as a
            // border around it.
            "w-3 after:top-1/2 after:h-10 after:w-1 after:-translate-y-1/2 after:rounded-full after:transition-colors after:duration-150 hover:after:bg-muted-foreground/40 focus-visible:after:bg-ring active:after:bg-primary/60",
        className,
      )}
      onDoubleClick={onReset}
      onPointerDown={handlePointerDown}
    />
  );
}
