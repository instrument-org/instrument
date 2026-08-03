import Panzoom, {
  type PanzoomEventDetail,
  type PanzoomObject,
} from "@panzoom/panzoom";
import { type RefObject, useEffect, useRef, useState } from "react";

// Fit is the floor: a diagram is already sized to its column, and letting it
// shrink below that only opens gaps around it.
const MIN_SCALE = 1;
// An SVG carries detail all the way down, so the ceiling is only about keeping
// the gesture from running away.
const MAX_SCALE = 8;
const ZOOMED_IN_THRESHOLD = 1.01;

/**
 * Wheel, pinch and drag zoom for a diagram sitting inline in a transcript.
 *
 * The transcript scrolls, which decides the one thing that differs from the
 * image viewer's panzoom: a bare wheel has to keep scrolling the page. Zoom is
 * on the modifier, which is also what a trackpad pinch arrives as, so the
 * gesture people already use works and a scroll over a diagram never traps
 * itself.
 */
export function useDiagramPanzoom({
  contentRef,
  enabled,
  viewportRef,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  /** Whether the diagram is the thing currently on screen. Refs alone cannot
   * carry this: they hold no identity React can depend on, so a surface that
   * mounts later (the diagram replacing its source block, or the source view
   * being toggled back) would leave this bound to an element long detached. */
  enabled: boolean;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const panzoomRef = useRef<null | PanzoomObject>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!enabled || !viewport || !content) {
      return;
    }

    const panzoom = Panzoom(content, {
      // Panzoom would otherwise put a move cursor on the diagram at every
      // scale, promising a drag that does nothing until it is zoomed.
      cursor: "default",
      maxScale: MAX_SCALE,
      minScale: MIN_SCALE,
      // At fit scale there is nothing outside the frame to drag into view, and
      // a drag that moves nothing reads as the diagram being stuck.
      panOnlyWhenZoomed: true,
    });
    panzoomRef.current = panzoom;

    const handleWheel = (event: WheelEvent) => {
      // Bare wheel belongs to the transcript. macOS reports a trackpad pinch as
      // ctrl+wheel, so this is also what makes pinch work.
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }
      event.preventDefault();
      panzoom.zoomWithWheel(event);
    };

    const handleChange = (event: Event) => {
      // panzoomchange's detail isn't in lib.dom's CustomEvent typing.
      const { scale } = (event as CustomEvent<PanzoomEventDetail>).detail;
      setIsZoomed(scale > ZOOMED_IN_THRESHOLD);
    };

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    content.addEventListener("panzoomchange", handleChange);

    return () => {
      content.removeEventListener("panzoomchange", handleChange);
      viewport.removeEventListener("wheel", handleWheel);
      panzoom.destroy();
      panzoom.resetStyle();
      panzoomRef.current = null;
      setIsZoomed(false);
    };
  }, [contentRef, enabled, viewportRef]);

  return {
    isZoomed,
    reset: () => panzoomRef.current?.reset(),
    zoomIn: () => panzoomRef.current?.zoomIn(),
    zoomOut: () => panzoomRef.current?.zoomOut(),
  };
}
