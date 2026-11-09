import {
  type PictureChord,
  pictureHoldingKeyboard,
  type PictureKeys,
  setPictureKeys,
} from "@/client/lib/picture-keys";
import {
  FIT_VIEW,
  panReach,
  type PictureBox,
  type PictureView,
  settleView,
  zoomedAt,
} from "@/client/lib/picture-view";
import { commandKeyHeld, normalizeWheelDeltaPx } from "@/client/lib/utils";
import { type RefObject, useEffect, useRef, useState } from "react";

// The image viewer tags the panzoom viewport element with this class (see
// image-viewer).
export const IMAGE_PANZOOM_VIEWPORT_CLASS = "image-panzoom-viewport";

const ZOOMED_IN_THRESHOLD = 1.01;
// Where a double-click lands on a picture already at its actual size or smaller.
const DOUBLE_CLICK_SCALE = 2;
// How far zoom goes, from a picture's fit size or its actual size, whichever
// is further in: far enough to read a diagram or count a screenshot's pixels.
const MAX_ZOOM = 8;
// What Zoom In and Zoom Out multiply the scale by.
const ZOOM_STEP = 1.5;
// How far an arrow moves a zoomed picture, in layout px.
const ARROW_STEP = 64;
const ANIMATED_TRANSITION = "transform 200ms ease-out";
const ARROW_TRANSITION = "transform 120ms ease-out";

// Percentage change per wheel pixel, so it feels consistent whether
// wheel/trackpad deltas are large or small, and at any zoom level.
const WHEEL_ZOOM_SENSITIVITY = 0.0015;

const ARROWS: Record<string, { x: number; y: number }> = {
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
};

/**
 * Pan and zoom for the picture in `contentRef`, inside `viewportRef`, its DOM
 * parent. Every input (wheel, drag, pinch, double-click, the menu, the keys, a
 * resize) proposes a view, and `show` settles it (`settleView`) and writes it
 * as `contentRef`'s transform, so none can leave the picture off its edges.
 */
export function useImagePanzoom({
  contentRef,
  viewportRef,
}: {
  contentRef: RefObject<HTMLDivElement | null>;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const controlsRef = useRef<null | {
    actualSize: () => void;
    fit: () => void;
    zoom: (direction: "in" | "out") => void;
  }>(null);
  const [scale, setScale] = useState(FIT_VIEW.scale);
  const [canPan, setCanPan] = useState(false);
  // The scale at which one image pixel fills one device pixel, once it is known.
  const [actualScale, setActualScale] = useState<null | number>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) {
      return;
    }
    const img = content.querySelector("img");
    let view = FIT_VIEW;

    const boxNow = (): PictureBox => {
      const actual = img && getActualScale(img, viewport);
      return {
        imageHeight: img?.clientHeight ?? 0,
        imageWidth: img?.clientWidth ?? 0,
        maxScale: MAX_ZOOM * Math.max(actual ?? 1, 1),
        viewHeight: viewport.clientHeight,
        viewWidth: viewport.clientWidth,
      };
    };
    const reachNow = (box = boxNow()) => panReach(box, view.scale);
    const canPanNow = () => {
      const reach = reachNow();
      return reach.x > 0 || reach.y > 0;
    };

    const show = (next: PictureView, transition = "none") => {
      view = settleView(next, boxNow());
      content.style.transition = transition;
      content.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
      setScale(view.scale);
      setCanPan(canPanNow());
    };

    /** On-screen px to layout px, from the pane's center. */
    const pointIn = ({ clientX, clientY }: PointLike) => {
      const rect = viewport.getBoundingClientRect();
      const appZoom = rect.width / viewport.offsetWidth || 1;
      return {
        x: (clientX - rect.left - rect.width / 2) / appZoom,
        y: (clientY - rect.top - rect.height / 2) / appZoom,
      };
    };

    const stepScale = (direction: "in" | "out") => {
      const actual = img && getActualScale(img, viewport);
      const stepped =
        direction === "in" ? view.scale * ZOOM_STEP : view.scale / ZOOM_STEP;
      // A step across the actual size stops on it.
      const crosses =
        actual !== null &&
        (direction === "in"
          ? view.scale < actual && actual < stepped
          : stepped < actual && actual < view.scale);
      return crosses ? actual : stepped;
    };
    const zoomStep = (direction: "in" | "out") => {
      show(
        zoomedAt(view, stepScale(direction), { x: 0, y: 0 }, boxNow()),
        ANIMATED_TRANSITION,
      );
    };
    const fit = () => {
      show(FIT_VIEW, ANIMATED_TRANSITION);
    };
    controlsRef.current = {
      actualSize: () => {
        const actual = img && getActualScale(img, viewport);
        if (actual) {
          show(
            zoomedAt(view, actual, { x: 0, y: 0 }, boxNow()),
            ANIMATED_TRANSITION,
          );
        }
      },
      fit,
      zoom: zoomStep,
    };

    const keys: PictureKeys = {
      canPan: canPanNow,
      pan: (dx, dy) => {
        show({ ...view, x: view.x - dx, y: view.y - dy }, ARROW_TRANSITION);
      },
      zoom: (chord: PictureChord) => {
        if (chord === "zoomReset") {
          fit();
        } else {
          zoomStep(chord === "zoomIn" ? "in" : "out");
        }
      },
    };
    const stopAnsweringKeys = setPictureKeys(viewport, keys);
    // After everything that answers an arrow on the way down and through the
    // tree: a list or menu holding the keyboard has had its turn.
    const handleKeyDown = (event: KeyboardEvent) => {
      const arrow = ARROWS[event.key];
      if (
        !arrow ||
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey ||
        pictureHoldingKeyboard() !== keys ||
        !canPanNow()
      ) {
        return;
      }
      event.preventDefault();
      keys.pan(arrow.x * ARROW_STEP, arrow.y * ARROW_STEP);
    };
    window.addEventListener("keydown", handleKeyDown);

    let lastImageWidth = 0;
    const readSizes = () => {
      lastImageWidth = img?.clientWidth ?? 0;
      setActualScale(img && getActualScale(img, viewport));
      show(view);
    };
    if (img?.complete) {
      readSizes();
    }
    // Every load rather than the first: a file written while it is open comes
    // back in the same element at its new size.
    img?.addEventListener("load", readSizes);

    let pendingDeltaPx = 0;
    let pendingWheelPoint: null | PointLike = null;
    let pendingPanX = 0;
    let pendingPanY = 0;
    let wheelFrame: number | undefined;
    const applyPendingWheel = () => {
      wheelFrame = undefined;
      if (pendingPanX !== 0 || pendingPanY !== 0) {
        show({ ...view, x: view.x - pendingPanX, y: view.y - pendingPanY });
      }
      pendingPanX = 0;
      pendingPanY = 0;
      const point = pendingWheelPoint;
      const deltaPx = pendingDeltaPx;
      pendingWheelPoint = null;
      pendingDeltaPx = 0;
      if (point) {
        show(
          zoomedAt(
            view,
            view.scale * Math.exp(-deltaPx * WHEEL_ZOOM_SENSITIVITY),
            pointIn(point),
            boxNow(),
          ),
        );
      }
    };
    // Accumulated and applied once per frame rather than per wheel event, since
    // a trackpad sends many in a frame and each write forces layout reads.
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      // A trackpad pinch arrives as a wheel with ctrl held.
      if (event.ctrlKey || commandKeyHeld(event)) {
        pendingDeltaPx += normalizeWheelDeltaPx(event);
        pendingWheelPoint = event;
      } else {
        pendingPanX += normalizeWheelDeltaPx(event, event.deltaX);
        pendingPanY += normalizeWheelDeltaPx(event);
      }
      if (wheelFrame === undefined) {
        wheelFrame = window.requestAnimationFrame(applyPendingWheel);
      }
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (view.scale > ZOOMED_IN_THRESHOLD) {
        fit();
        return;
      }
      const actual = img && getActualScale(img, viewport);
      show(
        zoomedAt(
          view,
          actual && actual > ZOOMED_IN_THRESHOLD ? actual : DOUBLE_CLICK_SCALE,
          pointIn(event),
          boxNow(),
        ),
        ANIMATED_TRANSITION,
      );
    };

    // The fingers on the pane, for a pinch on a touch screen.
    const touches = new Map<number, PointLike>();
    let pinch: null | {
      distance: number;
      middle: PointLike;
      start: PictureView;
    } = null;
    const fingers = () => {
      const [a, b] = [...touches.values()];
      return a && b
        ? {
            distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
            middle: {
              clientX: (a.clientX + b.clientX) / 2,
              clientY: (a.clientY + b.clientY) / 2,
            },
          }
        : null;
    };
    let drag: null | { press: PointLike; start: PictureView } = null;
    let stopFollowing: (() => void) | undefined;
    const handlePointerMove = (event: PointerEvent) => {
      if (touches.has(event.pointerId)) {
        touches.set(event.pointerId, event);
      }
      const now = pinch && fingers();
      if (pinch && now) {
        const { x, y } = pointIn(now.middle);
        const was = pointIn(pinch.middle);
        const zoomed = zoomedAt(
          pinch.start,
          pinch.start.scale * (now.distance / pinch.distance),
          was,
          boxNow(),
        );
        show({ ...zoomed, x: zoomed.x + x - was.x, y: zoomed.y + y - was.y });
      } else if (drag) {
        const point = pointIn(event);
        const was = pointIn(drag.press);
        show({
          ...drag.start,
          x: drag.start.x + point.x - was.x,
          y: drag.start.y + point.y - was.y,
        });
      }
    };
    const handlePointerEnd = (event: PointerEvent) => {
      touches.delete(event.pointerId);
      pinch = null;
      drag = null;
      if (touches.size === 0) {
        stopFollowing?.();
        stopFollowing = undefined;
      }
    };
    // On the window, for a press that runs off the pane.
    const follow = () => {
      if (stopFollowing) {
        return;
      }
      const controller = new AbortController();
      const { signal } = controller;
      window.addEventListener("pointermove", handlePointerMove, { signal });
      window.addEventListener("pointerup", handlePointerEnd, { signal });
      window.addEventListener("pointercancel", handlePointerEnd, { signal });
      stopFollowing = () => {
        controller.abort();
      };
    };
    const handlePointerDown = (event: PointerEvent) => {
      // A press takes the keyboard, whichever way it goes from here.
      viewport.focus({ preventScroll: true });
      // Right-click (or macOS Ctrl+click) opens the context menu.
      if (event.button !== 0 || event.ctrlKey) {
        return;
      }
      if (event.pointerType === "touch") {
        touches.set(event.pointerId, event);
        const now = fingers();
        if (now) {
          drag = null;
          pinch = { ...now, start: view };
          follow();
          return;
        }
      }
      // With nowhere to move, the press is left alone, and the image can be
      // dragged out to the desktop from exactly the state where dragging it
      // means nothing else. Otherwise cancelling it is also what stops the
      // browser starting a drag on the image under it.
      if (canPanNow()) {
        event.preventDefault();
        event.stopPropagation();
        drag = { press: event, start: view };
      }
      if (drag || touches.size > 0) {
        follow();
      }
    };

    let resizeFrame: number | undefined;
    const handleResize = () => {
      if (resizeFrame !== undefined) {
        window.cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = undefined;
        const width = img?.clientWidth ?? 0;
        // The fit size moves with the pane. A zoomed picture keeps the size it
        // is on screen, so the same spot stays at the pane's center.
        if (
          view.scale > ZOOMED_IN_THRESHOLD &&
          width > 0 &&
          lastImageWidth > 0
        ) {
          view = { ...view, scale: view.scale * (lastImageWidth / width) };
        }
        readSizes();
      });
    };
    // ResizeObserver (not window "resize") so panel-only resizes -- e.g.
    // dragging the artifact panel's divider -- also recompute.
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(viewport);

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("dblclick", handleDoubleClick);
    viewport.addEventListener("pointerdown", handlePointerDown);

    return () => {
      resizeObserver.disconnect();
      if (resizeFrame !== undefined) {
        window.cancelAnimationFrame(resizeFrame);
      }
      if (wheelFrame !== undefined) {
        window.cancelAnimationFrame(wheelFrame);
      }
      stopFollowing?.();
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("dblclick", handleDoubleClick);
      img?.removeEventListener("load", readSizes);
      window.removeEventListener("keydown", handleKeyDown);
      stopAnsweringKeys();
      controlsRef.current = null;
      content.style.removeProperty("transform");
      content.style.removeProperty("transition");
    };
  }, [contentRef, viewportRef]);

  return {
    actualScale,
    actualSize: () => {
      controlsRef.current?.actualSize();
    },
    canPan,
    fit: () => {
      controlsRef.current?.fit();
    },
    isZoomed: scale > ZOOMED_IN_THRESHOLD,
    scale,
    zoomIn: () => {
      controlsRef.current?.zoom("in");
    },
    zoomOut: () => {
      controlsRef.current?.zoom("out");
    },
  };
}

type PointLike = Pick<MouseEvent, "clientX" | "clientY">;

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
