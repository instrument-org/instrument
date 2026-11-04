import { commandKeyHeld, normalizeWheelDeltaPx } from "@/client/lib/utils";
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
const MIN_SCALE = 1;
// Where a double-click lands on a picture already at its actual size or smaller.
const DOUBLE_CLICK_SCALE = 2;
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
 * itself, but the wheel (a pinch or Cmd+wheel zooms, a plain scroll pans, both
 * delta-accumulated and applied once per animation frame), double-click,
 * right-click pan suppression, resize recentering, and the native-resolution
 * zoom cap aren't part of the library and are wired here.
 */
export function useImagePanzoom({
  contentRef,
  viewportRef,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const panzoomRef = useRef<null | PanzoomObject>(null);
  const [scale, setScale] = useState(MIN_SCALE);
  // The scale at which one image pixel fills one device pixel, once it is known.
  const [actualScale, setActualScale] = useState<null | number>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) {
      return;
    }

    const panzoom = Panzoom(content, {
      // Its default is a `move` cursor at every scale. The viewer's classes say
      // what a press means instead, from `isZoomed`.
      cursor: "",
      // Panzoom cancels the pointerdown by default, which is also what stops
      // the browser from starting a drag on the image under it. At the fit
      // scale there is no pan to protect -- panOnlyWhenZoomed has already
      // turned it off -- so the press is left alone, and the image can be
      // dragged out to the desktop from exactly the state where dragging it
      // means nothing else.
      handleStartEvent: (event) => {
        if ((panzoomRef.current?.getScale() ?? MIN_SCALE) <= MIN_SCALE) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      },
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
      setActualScale(img && getActualScale(img, viewport));
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
    }
    // Every load rather than the first: a file written while it is open comes
    // back in the same element at its new size.
    img?.addEventListener("load", applyNativeMaxScale);

    let pendingDeltaPx = 0;
    let pendingWheelEvent: null | WheelEvent = null;
    let pendingPanX = 0;
    let pendingPanY = 0;
    let wheelFrame: number | undefined;
    const applyPendingWheelPan = () => {
      const dx = pendingPanX;
      const dy = pendingPanY;
      pendingPanX = 0;
      pendingPanY = 0;
      const currentScale = panzoom.getScale();
      if (!img || (dx === 0 && dy === 0) || currentScale <= MIN_SCALE) {
        return;
      }
      // Panzoom's pan is applied inside its scale, and stops where the
      // picture's edge reaches the viewport's, so momentum can't fling it away.
      const reach = (image: number, view: number) =>
        Math.max(0, (image * currentScale - view) / 2) / currentScale;
      const reachX = reach(img.clientWidth, viewport.clientWidth);
      const reachY = reach(img.clientHeight, viewport.clientHeight);
      const { x, y } = panzoom.getPan();
      panzoom.pan(
        clamp(x - dx / currentScale, -reachX, reachX),
        clamp(y - dy / currentScale, -reachY, reachY),
        { force: true },
      );
    };
    const applyPendingWheelZoom = () => {
      wheelFrame = undefined;
      applyPendingWheelPan();
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
      // A trackpad pinch arrives as a wheel with ctrl held.
      if (event.ctrlKey || commandKeyHeld(event)) {
        pendingDeltaPx += normalizeWheelDeltaPx(event);
        pendingWheelEvent = event;
      } else {
        pendingPanX += normalizeWheelDeltaPx(event, event.deltaX);
        pendingPanY += normalizeWheelDeltaPx(event);
      }
      wheelFrame ??= window.requestAnimationFrame(applyPendingWheelZoom);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (panzoom.getScale() > ZOOMED_IN_THRESHOLD) {
        panzoom.reset();
        return;
      }
      const actual = img && getActualScale(img, viewport);
      panzoom.zoomToPoint(
        actual && actual > ZOOMED_IN_THRESHOLD ? actual : DOUBLE_CLICK_SCALE,
        event,
        { animate: true },
      );
    };

    const handleChange = (event: Event) => {
      // panzoomchange's detail isn't in lib.dom's CustomEvent typing.
      const detail = (event as CustomEvent<PanzoomEventDetail>).detail;
      // Focal (cursor-anchored) zoom-out leaves a residual pan offset even once
      // scale is back at the fit floor, where panOnlyWhenZoomed then blocks the
      // user from dragging it back. Snap it re-centered so zooming all the way
      // out always lands centered. The resulting pan(0,0) re-enters here with
      // x/y already 0, so it settles.
      if (detail.scale <= MIN_SCALE && (detail.x !== 0 || detail.y !== 0)) {
        panzoom.pan(0, 0, { animate: true, force: true });
      }
      setScale(detail.scale);
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
    viewport.addEventListener("dblclick", handleDoubleClick);
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
      viewport.removeEventListener("dblclick", handleDoubleClick);
      img?.removeEventListener("load", applyNativeMaxScale);
      panzoom.destroy();
      panzoom.resetStyle();
      panzoomRef.current = null;
    };
  }, [contentRef, viewportRef]);

  return {
    actualScale,
    actualSize: () => {
      if (actualScale) {
        panzoomRef.current?.zoom(actualScale, { animate: true });
      }
    },
    fit: () => panzoomRef.current?.reset(),
    isZoomed: scale > ZOOMED_IN_THRESHOLD,
    scale,
    zoomIn: () => panzoomRef.current?.zoomIn(),
    zoomOut: () => panzoomRef.current?.zoomOut(),
  };
}

// One image pixel per device pixel, which is what a screenshot looks like where
// it was taken. The viewport's two widths give the app's own zoom, since it is
// never transformed itself and `clientWidth` is the image's layout size at fit.
function getActualScale(img: HTMLImageElement, viewport: HTMLElement) {
  if (!img.naturalWidth || !img.clientWidth || !viewport.offsetWidth) {
    return null;
  }
  const appZoom = viewport.getBoundingClientRect().width / viewport.offsetWidth;
  return (
    img.naturalWidth / (img.clientWidth * appZoom * window.devicePixelRatio)
  );
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
