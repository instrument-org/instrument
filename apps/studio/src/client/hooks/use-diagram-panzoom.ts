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
 * image viewer's panzoom: the wheel is the page's until the reader hands it
 * over. A diagram that swallowed the scroll of everyone whose pointer crossed
 * it would be a trap, so taking it is deliberate — the capture toggle, or the
 * modifier a trackpad pinch already arrives as.
 */
export function useDiagramPanzoom({
  contentRef,
  enabled,
  rootRef,
  viewportRef,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  /** Whether the diagram is the thing currently on screen. Refs alone cannot
   * carry this: they hold no identity React can depend on, so a surface that
   * mounts later (the diagram replacing its source block, or the source view
   * being toggled back) would leave this bound to an element long detached. */
  enabled: boolean;
  /** The whole diagram block, controls included. Clicking away releases the
   * wheel, and the zoom buttons sit outside the panning frame — testing
   * against that frame alone would drop the capture on the way to the button
   * that was meant to use it. */
  rootRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const panzoomRef = useRef<null | PanzoomObject>(null);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  // Read by the wheel handler, which is bound once alongside the panzoom
  // instance: re-binding it per keystroke of state would mean tearing down the
  // instance and losing the zoom the reader had set.
  const isCapturingRef = useRef(false);
  const setCapturing = (next: boolean) => {
    isCapturingRef.current = next;
    setIsCapturing(next);
  };

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
      // Until the reader has taken the diagram, a bare wheel belongs to the
      // transcript — a diagram that swallowed the scroll of anyone whose
      // pointer crossed it would be a trap. macOS reports a trackpad pinch as
      // ctrl+wheel, which is why that works without taking anything.
      if (!isCapturingRef.current && !event.ctrlKey && !event.metaKey) {
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
      setCapturing(false);
    };
  }, [contentRef, enabled, viewportRef]);

  // Handing the wheel back has to be as easy as taking it, and neither of the
  // two ways out involves finding the button again.
  useEffect(() => {
    if (!isCapturing) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCapturing(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setCapturing(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isCapturing, rootRef]);

  return {
    isCapturing,
    isZoomed,
    reset: () => panzoomRef.current?.reset(),
    setCapturing,
    zoomIn: () => panzoomRef.current?.zoomIn(),
    zoomOut: () => panzoomRef.current?.zoomOut(),
  };
}
