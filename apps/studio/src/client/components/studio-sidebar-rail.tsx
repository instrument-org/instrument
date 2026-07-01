import {
  clampSidebarWidth,
  SIDEBAR_COLLAPSE_THRESHOLD,
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

  const applyWidth = (value: number) => {
    layoutWidth.set(value);
    panelWidth.set(value);
    panelX.set(0);
  };

  // Animate open/close whenever the open state flips (or the stored width changes
  // while open, e.g. a double-click reset). A drag drives the width by hand, and
  // a mid-drag collapse animates itself, so both are skipped here.
  useEffect(() => {
    if (isOpen) {
      collapsingRef.current = false;
    }
    if (draggingRef.current || (!isOpen && collapsingRef.current)) {
      return;
    }

    const controls: AnimationPlaybackControls[] = [];
    if (!isOpen) {
      controls.push(
        animate(layoutWidth, 0, SLIDE_TRANSITION),
        animate(panelX, -panelWidth.get(), SLIDE_TRANSITION),
        animate(opacity, 0, FADE_TRANSITION),
      );
    } else if (opacity.get() < 0.5) {
      // Reopening from closed: put the panel at full width off-screen, then slide in.
      panelWidth.set(storedWidth);
      controls.push(
        animate(layoutWidth, storedWidth, SLIDE_TRANSITION),
        animate(panelX, 0, SLIDE_TRANSITION),
        animate(opacity, 1, FADE_TRANSITION),
      );
    } else {
      // Already open (double-click reset): animate the width change in place.
      controls.push(
        animate(panelWidth, storedWidth, SLIDE_TRANSITION),
        animate(layoutWidth, storedWidth, SLIDE_TRANSITION),
      );
    }
    return () => {
      for (const control of controls) {
        control.stop();
      }
    };
  }, [isOpen, storedWidth, layoutWidth, opacity, panelWidth, panelX]);

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

    // clientX and the rail's left edge are both in the shell's zoomed coordinate
    // space, so divide by the shell zoom to recover the pre-zoom CSS width.
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

    const handleUp = (upEvent: PointerEvent) => {
      endDrag();
      if (!collapsingRef.current) {
        const finalWidth = clampSidebarWidth(rawWidthAt(upEvent.clientX));
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
          aria-orientation="vertical"
          className={cn(
            "absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize select-none",
            "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors",
            "hover:after:bg-muted-foreground/40 active:after:bg-primary/50",
          )}
          onDoubleClick={() => {
            setStoredWidth(SIDEBAR_WIDTH);
          }}
          onPointerDown={handlePointerDown}
          role="separator"
        />
      )}
    </motion.div>
  );
}
