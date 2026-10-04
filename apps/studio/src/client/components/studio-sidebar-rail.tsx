import { ResizeHandle } from "@/client/components/resize-handle";
import {
  RAIL_FADE_TRANSITION,
  RAIL_SLIDE_TRANSITION,
} from "@/client/lib/rail-motion";
import { cn } from "@/client/lib/utils";
import { useAtomValue, useSetAtom, type WritableAtom } from "jotai";
import {
  animate,
  type AnimationPlaybackControls,
  motion,
  useMotionValue,
} from "motion/react";
import { type ReactNode, useEffect, useEffectEvent, useRef } from "react";

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
  /** Dragged narrower than this, the rail slides shut; with none, a drag stops at the min. */
  collapse?: number;
  initial: number;
  max: number;
  min: number;
}

export function StudioSidebarRail({
  bounds,
  children,
  isAtOnce = false,
  isOpen,
  label = "Resize sidebar",
  onCollapse,
  panelClassName,
  side = "left",
  widthAtom,
}: {
  bounds: RailBounds;
  children: ReactNode;
  /** Whether the next open or close happens at once rather than sliding: one the window made for want of room, in the middle of a resize the slide would fight. */
  isAtOnce?: boolean;
  isOpen: boolean;
  label?: string;
  onCollapse: () => void;
  panelClassName?: string;
  /** Which edge of the window it hangs from; the handle is on the other. */
  side?: "left" | "right";
  /** Where its width is kept. */
  widthAtom: WritableAtom<number, [number], void>;
}) {
  const storedWidth = useAtomValue(widthAtom);
  const setStoredWidth = useSetAtom(widthAtom);
  const clampWidth = (value: number) =>
    Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
  // The panel slides out toward its own edge.
  const away = side === "left" ? -1 : 1;

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
  const currentStoredWidth = useEffectEvent(() => storedWidth);
  const currentIsAtOnce = useEffectEvent(() => isAtOnce);

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

    if (currentIsAtOnce()) {
      for (const control of widthAnimationsRef.current) {
        control.stop();
      }
      widthAnimationsRef.current = [];
      const width = currentStoredWidth();
      layoutWidth.set(isOpen ? width : 0);
      panelWidth.set(width);
      panelX.set(isOpen ? 0 : away * width);
      opacity.set(isOpen ? 1 : 0);
      return;
    }
    const controls: AnimationPlaybackControls[] = [];
    if (isOpen) {
      const width = currentStoredWidth();
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
          // Put away while closed, so nothing clipped out of sight takes the
          // keyboard.
          inert={!isOpen}
          style={{ width: panelWidth, x: panelX }}
        >
          {children}
        </motion.div>
      </div>
      {isOpen && (
        <ResizeHandle
          anchor={() => {
            const rect = containerRef.current?.getBoundingClientRect();
            return side === "left" ? rect?.left : rect?.right;
          }}
          className={
            side === "left"
              ? "right-0 translate-x-1/2"
              : "left-0 -translate-x-1/2"
          }
          collapse={
            bounds.collapse === undefined
              ? undefined
              : {
                  below: bounds.collapse,
                  onCollapse: () => {
                    collapsingRef.current = true;
                    draggingRef.current = false;
                    const frozenWidth = panelWidth.get();
                    void animate(layoutWidth, 0, RAIL_SLIDE_TRANSITION);
                    void animate(
                      panelX,
                      away * frozenWidth,
                      RAIL_SLIDE_TRANSITION,
                    );
                    void animate(opacity, 0, RAIL_FADE_TRANSITION);
                    onCollapse();
                  },
                }
          }
          getWidth={() => panelWidth.get()}
          grows={side === "left" ? "right" : "left"}
          label={label}
          max={bounds.max}
          min={bounds.min}
          onReset={() => {
            stopWidthAnimations();
            // Tracked like the slide's own, so a drag that starts while this
            // is still springing takes the values back from it.
            widthAnimationsRef.current = [
              animate(panelWidth, bounds.initial, RAIL_SLIDE_TRANSITION),
              animate(layoutWidth, bounds.initial, RAIL_SLIDE_TRANSITION),
            ];
            setStoredWidth(bounds.initial);
          }}
          onResize={(width) => {
            applyWidth(clampWidth(width));
          }}
          onResizeEnd={() => {
            draggingRef.current = false;
            // The last width applied rather than one read off the event: a
            // cancel carries zeroed coordinates.
            const finalWidth = clampWidth(panelWidth.get());
            applyWidth(finalWidth);
            setStoredWidth(finalWidth);
          }}
          onResizeStart={() => {
            stopWidthAnimations();
            draggingRef.current = true;
            collapsingRef.current = false;
          }}
          value={storedWidth}
        />
      )}
    </motion.div>
  );
}
