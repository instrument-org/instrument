import {
  clampSidebarWidth,
  SIDEBAR_COLLAPSE_THRESHOLD,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarWidthAtom,
} from "@/client/atoms/sidebar";
import { zoomAtom } from "@/client/atoms/zoom";
import { StudioSidebar } from "@/client/components/studio-sidebar";
import { cn } from "@/client/lib/utils";
import { SIDEBAR_WIDTH } from "@/shared/constants";
import { useAtomValue, useSetAtom } from "jotai";
import {
  animate,
  type AnimationPlaybackControls,
  motion,
  useMotionValue,
} from "motion/react";
import { useEffect, useRef } from "react";

const SLIDE_TRANSITION = {
  damping: 42,
  stiffness: 520,
  type: "spring",
} as const;
const FADE_TRANSITION = { duration: 0.14, ease: "easeOut" } as const;

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
export function StudioSidebarRail({
  isOpen,
  onCollapse,
}: {
  isOpen: boolean;
  onCollapse: () => void;
}) {
  const storedWidth = useAtomValue(sidebarWidthAtom);
  const setStoredWidth = useSetAtom(sidebarWidthAtom);
  const zoom = useAtomValue(zoomAtom);

  const layoutWidth = useMotionValue(isOpen ? storedWidth : 0);
  const panelWidth = useMotionValue(storedWidth);
  const panelX = useMotionValue(isOpen ? 0 : -storedWidth);
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
        animate(layoutWidth, width, SLIDE_TRANSITION),
        animate(panelWidth, width, SLIDE_TRANSITION),
        animate(panelX, 0, SLIDE_TRANSITION),
        animate(opacity, 1, FADE_TRANSITION),
      );
    } else {
      controls.push(
        animate(layoutWidth, 0, SLIDE_TRANSITION),
        animate(panelX, -panelWidth.get(), SLIDE_TRANSITION),
        animate(opacity, 0, FADE_TRANSITION),
      );
    }
    return () => {
      for (const control of controls) {
        control.stop();
      }
    };
  }, [isOpen, layoutWidth, opacity, panelWidth, panelX]);

  // Keyboard resize for the splitter (WAI-ARIA window-splitter pattern): arrows
  // nudge a step, Home/End jump to the bounds. Base each step off the live
  // panel width (not the render-time atom, which lags rapid presses) so repeated
  // presses accumulate.
  const KEYBOARD_STEP = 16;
  function nextKeyboardWidth(key: string): number | undefined {
    switch (key) {
      case "ArrowLeft": {
        return clampSidebarWidth(panelWidth.get() - KEYBOARD_STEP);
      }
      case "ArrowRight": {
        return clampSidebarWidth(panelWidth.get() + KEYBOARD_STEP);
      }
      case "End": {
        return SIDEBAR_WIDTH_MAX;
      }
      case "Home": {
        return SIDEBAR_WIDTH_MIN;
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
    const left = containerRef.current?.getBoundingClientRect().left ?? 0;
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
    const rawWidthAt = (clientX: number) => (clientX - left) / zoom;

    const handleMove = (moveEvent: PointerEvent) => {
      const raw = rawWidthAt(moveEvent.clientX);
      if (raw < SIDEBAR_COLLAPSE_THRESHOLD && !collapsingRef.current) {
        collapsingRef.current = true;
        endDrag();
        const frozenWidth = panelWidth.get();
        animate(layoutWidth, 0, SLIDE_TRANSITION);
        animate(panelX, -frozenWidth, SLIDE_TRANSITION);
        animate(opacity, 0, FADE_TRANSITION);
        onCollapse();
        return;
      }
      applyWidth(clampSidebarWidth(raw));
    };

    const handleUp = () => {
      endDrag();
      if (!collapsingRef.current) {
        // Commit the last width the drag applied, not one recomputed from the
        // event: pointercancel carries zeroed coordinates, which would persist
        // the min width regardless of where the drag actually ended.
        const finalWidth = clampSidebarWidth(panelWidth.get());
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
          className="absolute inset-y-0 left-0 flex h-full flex-col border-r border-border bg-sidebar select-none"
          style={{ width: panelWidth, x: panelX }}
        >
          <StudioSidebar className="min-h-0 w-full flex-1" />
        </motion.div>
      </div>
      {isOpen && (
        <div
          aria-label="Resize sidebar"
          aria-orientation="vertical"
          aria-valuemax={SIDEBAR_WIDTH_MAX}
          aria-valuemin={SIDEBAR_WIDTH_MIN}
          aria-valuenow={storedWidth}
          className={cn(
            "absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize select-none",
            "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors",
            "hover:after:bg-muted-foreground/40 active:after:bg-primary/50",
          )}
          onDoubleClick={() => {
            animate(panelWidth, SIDEBAR_WIDTH, SLIDE_TRANSITION);
            animate(layoutWidth, SIDEBAR_WIDTH, SLIDE_TRANSITION);
            setStoredWidth(SIDEBAR_WIDTH);
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
