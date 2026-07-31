import { normalizeWheelDeltaPx } from "@/client/lib/utils";
import Panzoom, {
  type PanzoomEventDetail,
  type PanzoomObject,
} from "@panzoom/panzoom";
import { clamp } from "radashi";
import { type RefObject, useEffect, useRef, useState } from "react";

// The image viewer tags the panzoom viewport element with this class (see
// image-viewer), which runs its own wheel zoom below.
export const IMAGE_PANZOOM_VIEWPORT_CLASS = "image-panzoom-viewport";

const ZOOMED_IN_THRESHOLD = 1.01;
const PANNED_THRESHOLD_PX = 2;
const MIN_SCALE = 1;
// Smallest the native-resolution cap is ever allowed to be. A small image is
// shown at (or below) native size to begin with, so its native cap alone would
// equal MIN_SCALE and leave nothing to zoom; this guarantees any image can be
// enlarged at least this far beyond its fit size (see getNativeMaxScale).
const MIN_MAX_SCALE = 3;
// Used only until the image's natural size is known (see getNativeMaxScale);
// any transient overshoot before then is snapped back once it is.
const INITIAL_MAX_SCALE = Infinity;

// Percentage change per wheel pixel, so it feels consistent whether
// wheel/trackpad deltas are large or small, and at any zoom level.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

/**
 * Wires @panzoom/panzoom onto `contentRef`, which Panzoom scales/pans in
 * place, inside `viewportRef`, its DOM parent, which Panzoom styles directly
 * (overflow, touch-action, cursor). Panzoom binds pointer-based pan/pinch
 * itself, but wheel zoom (delta-accumulated, applied once per animation
 * frame), right-click pan suppression, resize recentering, and the
 * native-resolution zoom cap aren't part of the library and are wired here.
 */
export function useImagePanzoom({
  contentRef,
  viewportRef,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const panzoomRef = useRef<null | PanzoomObject>(null);
  const [canReset, setCanReset] = useState(false);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) {
      return;
    }

    const panzoom = Panzoom(content, {
      maxScale: INITIAL_MAX_SCALE,
      minScale: MIN_SCALE,
      // Dragging does nothing useful at the fit-to-container scale; only
      // allow it once the user has actually zoomed in.
      panOnlyWhenZoomed: true,
    });
    panzoomRef.current = panzoom;
    let currentMaxScale = INITIAL_MAX_SCALE;

    const img = content.querySelector("img");
    const applyNativeMaxScale = () => {
      const maxScale = img && getNativeMaxScale(img);
      if (!maxScale) {
        return;
      }
      currentMaxScale = maxScale;
      panzoom.setOptions({ maxScale });
      // setOptions doesn't re-clamp the already-applied scale.
      if (panzoom.getScale() > maxScale) {
        panzoom.zoom(maxScale, { animate: true });
      }
    };
    if (img?.complete) {
      applyNativeMaxScale();
    } else {
      img?.addEventListener("load", applyNativeMaxScale, { once: true });
    }

    let pendingDeltaPx = 0;
    let pendingWheelEvent: null | WheelEvent = null;
    let wheelFrame: number | undefined;
    const applyPendingWheelZoom = () => {
      wheelFrame = undefined;
      const event = pendingWheelEvent;
      const deltaPx = pendingDeltaPx;
      pendingWheelEvent = null;
      pendingDeltaPx = 0;
      if (!event) {
        return;
      }
      const currentScale = panzoom.getScale();
      const targetScale = clamp(
        currentScale * Math.exp(-deltaPx * WHEEL_ZOOM_SENSITIVITY),
        MIN_SCALE,
        currentMaxScale,
      );
      // Already at a bound and still pushing past it: skip the no-op zoom, which
      // otherwise forces a layout read + transform write for nothing (e.g.
      // trackpad momentum continuing to fire after scale hits minScale).
      if (targetScale === currentScale) {
        return;
      }
      panzoom.zoomToPoint(targetScale, event);
    };
    // Accumulated and applied once per frame rather than per wheel event,
    // since each applied zoom forces a synchronous layout read internally --
    // doing that on every event in a fast wheel/trackpad burst visibly stutters.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      pendingDeltaPx += normalizeWheelDeltaPx(event);
      pendingWheelEvent = event;
      wheelFrame ??= window.requestAnimationFrame(applyPendingWheelZoom);
    };

    const handleChange = (event: Event) => {
      // panzoomchange's detail isn't in lib.dom's CustomEvent typing.
      const { scale, x, y } = (event as CustomEvent<PanzoomEventDetail>).detail;
      // Focal (cursor-anchored) zoom-out leaves a residual pan offset even once
      // scale is back at the fit floor, where panOnlyWhenZoomed then blocks the
      // user from dragging it back. Snap it re-centered so zooming all the way
      // out always lands centered, without needing the reset button. The
      // resulting pan(0,0) re-enters here with x/y already 0, so it settles.
      if (scale <= MIN_SCALE && (x !== 0 || y !== 0)) {
        panzoom.pan(0, 0, { animate: true, force: true });
        return;
      }
      setCanReset(
        scale > ZOOMED_IN_THRESHOLD ||
          Math.abs(x) > PANNED_THRESHOLD_PX ||
          Math.abs(y) > PANNED_THRESHOLD_PX,
      );
    };

    // Right-click (or macOS Ctrl+click) opens the context menu; don't let it
    // also start a pan.
    const handlePointerDownCapture = (event: PointerEvent) => {
      if (event.button === 2 || (event.button === 0 && event.ctrlKey)) {
        event.stopPropagation();
      }
    };

    let resizeFrame: number | undefined;
    const handleResize = () => {
      if (resizeFrame !== undefined) {
        window.cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = undefined;
        // The fit size (and so the native-resolution cap) changes with layout.
        applyNativeMaxScale();
        panzoom.pan(0, 0, { animate: false, force: true });
      });
    };
    // ResizeObserver (not window "resize") so panel-only resizes -- e.g.
    // dragging the artifact panel's divider -- also recompute.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(viewport);

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("pointerdown", handlePointerDownCapture, {
      capture: true,
    });
    content.addEventListener("panzoomchange", handleChange);

    return () => {
      resizeObserver.disconnect();
      if (resizeFrame !== undefined) {
        window.cancelAnimationFrame(resizeFrame);
      }
      if (wheelFrame !== undefined) {
        window.cancelAnimationFrame(wheelFrame);
      }
      content.removeEventListener("panzoomchange", handleChange);
      viewport.removeEventListener("pointerdown", handlePointerDownCapture, {
        capture: true,
      });
      viewport.removeEventListener("wheel", handleWheel);
      img?.removeEventListener("load", applyNativeMaxScale);
      panzoom.destroy();
      panzoom.resetStyle();
      panzoomRef.current = null;
    };
  }, [contentRef, viewportRef]);

  return {
    canReset,
    reset: () => panzoomRef.current?.reset(),
    zoomIn: () => panzoomRef.current?.zoomIn(),
    zoomOut: () => panzoomRef.current?.zoomOut(),
  };
}

// `clientWidth` is the pre-transform layout size (CSS transforms don't affect
// it), so this stays correct regardless of the current zoom. Caps zoom at 1
// image pixel per CSS pixel for images large enough to be downscaled into the
// viewport -- past that, zooming a raster image further just blows up pixels
// with no new detail, and an unbounded cap reads as broken rather than
// intentional. Small images already shown at native size would cap at
// MIN_SCALE, so MIN_MAX_SCALE floors the cap to keep them enlargeable.
function getNativeMaxScale(img: HTMLImageElement) {
  if (!img.naturalWidth || !img.clientWidth) {
    return null;
  }
  return Math.max(img.naturalWidth / img.clientWidth, MIN_MAX_SCALE);
}
