import {
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarWidthAtom,
} from "@/client/atoms/sidebar";
import { zoomAtom } from "@/client/atoms/zoom";
import { StudioSidebar } from "@/client/components/studio-sidebar";
import {
  RAIL_FADE_TRANSITION,
  RAIL_SLIDE_TRANSITION,
} from "@/client/lib/rail-motion";
import { cn } from "@/client/lib/utils";
import { SIDEBAR_WIDTH } from "@/shared/constants";
import { useAtomValue, useSetAtom } from "jotai";
import {
  animate,
  type AnimationPlaybackControls,
  motion,
  useMotionValue,
} from "motion/react";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * The resizable sidebar rail. Width is driven imperatively so dragging tracks
 * the cursor 1:1 with no transition. Open/close is a slide: the panel keeps its
 * width and translates out through a clip while the reserved layout width and
 * opacity animate alongside, so the content never reflows/squishes on the way
 * out. Dragging the handle left past the collapse threshold slides it away
 * immediately, mid-drag, rather than snapping shut after the user lets go.
 *
 * - `layoutWidth`: space the rail reserves in the row (0 when closed).
 * - `panelWidth`: the panel's own width; follows the drag but stays put while
 *   sliding out, which is what prevents the squish.
 * - `panelX`: how far the panel is translated out of its clip.
 */
/** How wide a rail may be, where a drag lets go of it, and where it opens. */
export interface RailBounds {
  collapse: number;
  initial: number;
  max: number;
  min: number;
}

const SIDEBAR_BOUNDS: RailBounds = {
  collapse: SIDEBAR_COLLAPSE_THRESHOLD,
  initial: SIDEBAR_WIDTH,
  max: SIDEBAR_WIDTH_MAX,
  min: SIDEBAR_WIDTH_MIN,
};

export function StudioSidebarRail({
  bounds = SIDEBAR_BOUNDS,
  children,
  isOpen,
  label = "Resize sidebar",
  onCollapse,
  panelClassName,
  side = "left",
  widthAtom = sidebarWidthAtom,
}: {
  bounds?: RailBounds;
  /** What the rail holds; the Studio sidebar unless a window brings its own. */
  children?: ReactNode;
  isOpen: boolean;
  label?: string;
  onCollapse: () => void;
  panelClassName?: string;
  /** Which edge of the window it hangs from; the handle is on the other. */
  side?: "left" | "right";
  /** Where its width is kept; Studio's sidebar's unless a rail brings its own. */
  widthAtom?: typeof sidebarWidthAtom;
}) {
  const storedWidth = useAtomValue(widthAtom);
  const setStoredWidth = useSetAtom(widthAtom);
  const clampWidth = (value: number) =>
    Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
  // The panel slides out toward its own edge.
  const away = side === "left" ? -1 : 1;
  const zoom = useAtomValue(zoomAtom);

  const layoutWidth = useMotionValue(isOpen ? storedWidth : 0);
  const panelWidth = useMotionValue(storedWidth);
  const panelX = useMotionValue(isOpen ? 0 : away * storedWidth);
  const opacity = useMotionValue(isOpen ? 1 : 0);

  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const collapsingRef = useRef(false);

  // Read the latest stored width from inside the open/close effect without
  // making it a dependency: width tweaks (drag, keyboard, double-click) apply
  // their own animation, so re-running the slide spring on every width change
  // would fight them and jitter.
  const storedWidthRef = useRef(storedWidth);
  useEffect(() => {
    storedWidthRef.current = storedWidth;
  }, [storedWidth]);

  const applyWidth = (value: number) => {
    layoutWidth.set(value);
    panelWidth.set(value);
    panelX.set(0);
  };

  // Whatever is currently driving those values, so an interaction can take them
  // back. `set` changes a motion value without canceling its animation, so a
  // spring still running writes over every frame a drag applies -- the rail
  // ignores the pointer, and the width committed on pointerup is one the spring
  // then overwrites on its way to the old target. The handle is on screen for
  // the whole of an opening slide, so that window is reachable by hand.
  const widthAnimationsRef = useRef<AnimationPlaybackControls[]>([]);

  function stopWidthAnimations() {
    for (const control of widthAnimationsRef.current) {
      control.stop();
    }
    widthAnimationsRef.current = [];
    // Only reachable while the rail is open, so a half-played fade is finished
    // rather than left at whatever the interrupted slide had reached.
    opacity.set(1);
  }

  // Slide the panel in/out when the open state flips. Width changes while open
  // are driven directly by their handlers, so this only reacts to open/close. A
  // drag drives the width by hand and a mid-drag collapse animates itself, so
  // both are skipped here.
  useEffect(() => {
    if (isOpen) {
      collapsingRef.current = false;
    }
    if (draggingRef.current || (!isOpen && collapsingRef.current)) {
      return;
    }

    const controls: AnimationPlaybackControls[] = [];
    if (isOpen) {
      const width = storedWidthRef.current;
      // Opening: always drive panelX/opacity home so a reopen mid-close-fade
      // can't leave the panel translated out or dimmed. Only when genuinely
      // closed (no reserved layout width) pre-size the panel so it slides in at
      // full width instead of growing from 0.
      if (layoutWidth.get() === 0) {
        panelWidth.set(width);
      }
      controls.push(
        animate(layoutWidth, width, RAIL_SLIDE_TRANSITION),
        animate(panelWidth, width, RAIL_SLIDE_TRANSITION),
        animate(panelX, 0, RAIL_SLIDE_TRANSITION),
        animate(opacity, 1, RAIL_FADE_TRANSITION),
      );
    } else {
      controls.push(
        animate(layoutWidth, 0, RAIL_SLIDE_TRANSITION),
        animate(panelX, away * panelWidth.get(), RAIL_SLIDE_TRANSITION),
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
  }, [away, isOpen, layoutWidth, opacity, panelWidth, panelX]);

  // Keyboard resize for the splitter (WAI-ARIA window-splitter pattern): arrows
  // nudge a step, Home/End jump to the bounds. Base each step off the live
  // panel width (not the render-time atom, which lags rapid presses) so repeated
  // presses accumulate.
  const KEYBOARD_STEP = 16;
  function nextKeyboardWidth(key: string): number | undefined {
    switch (key) {
      case "ArrowLeft": {
        // Toward the window edge shrinks, away from it grows, whichever edge.
        return clampWidth(panelWidth.get() + away * KEYBOARD_STEP);
      }
      case "ArrowRight": {
        return clampWidth(panelWidth.get() - away * KEYBOARD_STEP);
      }
      case "End": {
        return bounds.max;
      }
      case "Home": {
        return bounds.min;
      }
      default: {
        return undefined;
      }
    }
  }
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const next = nextKeyboardWidth(event.key);
    if (next === undefined) {
      return;
    }
    event.preventDefault();
    stopWidthAnimations();
    applyWidth(next);
    setStoredWidth(next);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();

    const handle = event.currentTarget;
    const { pointerId } = event;
    const rect = containerRef.current?.getBoundingClientRect();
    const edge = (side === "left" ? rect?.left : rect?.right) ?? 0;
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

    // clientX and the rail's left edge are both in the main window's zoomed coordinate
    // space, so divide by the main-window zoom to recover the pre-zoom CSS width.
    const rawWidthAt = (clientX: number) =>
      (side === "left" ? clientX - edge : edge - clientX) / zoom;

    const handleMove = (moveEvent: PointerEvent) => {
      const raw = rawWidthAt(moveEvent.clientX);
      if (raw < bounds.collapse && !collapsingRef.current) {
        collapsingRef.current = true;
        endDrag();
        const frozenWidth = panelWidth.get();
        animate(layoutWidth, 0, RAIL_SLIDE_TRANSITION);
        animate(panelX, away * frozenWidth, RAIL_SLIDE_TRANSITION);
        animate(opacity, 0, RAIL_FADE_TRANSITION);
        onCollapse();
        return;
      }
      applyWidth(clampWidth(raw));
    };

    const handleUp = () => {
      endDrag();
      if (!collapsingRef.current) {
        // Commit the last width the drag applied, not one recomputed from the
        // event: pointercancel carries zeroed coordinates, which would persist
        // the min width regardless of where the drag actually ended.
        const finalWidth = clampWidth(panelWidth.get());
        applyWidth(finalWidth);
        setStoredWidth(finalWidth);
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
    // Capture can end without a pointerup ever arriving -- the element is
    // replaced, the window loses the device, the OS takes the gesture. Ending
    // the same way keeps two things true: the move listener does not outlive
    // the drag, so the rail cannot follow a pointer merely passing over the
    // handle, and the width the drag reached is still the width that gets
    // kept. Releasing the pointer also raises this, after `handleUp` has
    // already torn the listeners down, so it runs once either way.
    handle.addEventListener("lostpointercapture", handleUp, {
      signal: listeners.signal,
    });
  }

  return (
    <motion.div
      className="relative flex h-full shrink-0"
      ref={containerRef}
      style={{ opacity, width: layoutWidth }}
    >
      <div className="relative h-full w-full overflow-hidden">
        {/* select-none only on chrome; content/modal text stays selectable
            so users can copy messages, code, and files. */}
        <motion.div
          className={cn(
            "absolute inset-y-0 flex h-full flex-col border-border bg-sidebar select-none",
            side === "left" ? "left-0 border-r" : "right-0 border-l",
            panelClassName,
          )}
          style={{ width: panelWidth, x: panelX }}
        >
          {children ?? <StudioSidebar className="min-h-0 w-full flex-1" />}
        </motion.div>
      </div>
      {isOpen && (
        <div
          aria-label={label}
          aria-orientation="vertical"
          aria-valuemax={bounds.max}
          aria-valuemin={bounds.min}
          aria-valuenow={storedWidth}
          className={cn(
            "absolute inset-y-0 z-20 w-2 cursor-col-resize select-none",
            side === "left"
              ? "right-0 translate-x-1/2"
              : "left-0 -translate-x-1/2",
            "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent",
            "outline-hidden hover:after:bg-muted-foreground/40 focus-visible:after:w-0.5 focus-visible:after:bg-ring active:after:bg-primary/50",
          )}
          onDoubleClick={() => {
            stopWidthAnimations();
            // Tracked like the slide's own, so a drag that starts while this
            // is still springing takes the values back from it.
            widthAnimationsRef.current = [
              animate(panelWidth, bounds.initial, RAIL_SLIDE_TRANSITION),
              animate(layoutWidth, bounds.initial, RAIL_SLIDE_TRANSITION),
            ];
            setStoredWidth(bounds.initial);
          }}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          role="separator"
          tabIndex={0}
        />
      )}
    </motion.div>
  );
}
