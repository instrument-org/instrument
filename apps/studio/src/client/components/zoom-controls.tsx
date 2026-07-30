import { ZOOM_MAX, ZOOM_MIN, zoomAtom } from "@/client/atoms/zoom";
import { cn } from "@/client/lib/utils";
import { steppedZoom } from "@/shared/zoom";
import {
  ArrowCounterClockwiseIcon,
  MinusIcon,
  PlusIcon,
} from "@phosphor-icons/react";
import { useAtom } from "jotai";
import { type ReactNode, useEffect, useRef, useState } from "react";

// How long the transient readout stays up after the last zoom change (or after
// the pointer leaves it, so its reset button is reachable while hovered).
const ZOOM_TOAST_MS = 2200;

/**
 * Full stepper for the main-window UI zoom ({@link zoomAtom}), driving the atom
 * directly. Meant for a settings row.
 */
export function ZoomStepper() {
  const [zoom, setZoom] = useAtom(zoomAtom);

  return (
    <ZoomStepperControl
      onReset={() => {
        setZoom(1);
      }}
      onZoomIn={() => {
        setZoom((z) =>
          steppedZoom({
            direction: "in",
            factor: z,
            max: ZOOM_MAX,
            min: ZOOM_MIN,
          }),
        );
      }}
      onZoomOut={() => {
        setZoom((z) =>
          steppedZoom({
            direction: "out",
            factor: z,
            max: ZOOM_MAX,
            min: ZOOM_MIN,
          }),
        );
      }}
      percent={Math.round(zoom * 100)}
    />
  );
}

/**
 * Shared hover treatment for every segment of {@link ZoomStepperControl}, and
 * for a readout a caller substitutes in.
 */
export const zoomStepperSegmentClassName =
  "hover:bg-secondary dark:hover:bg-gray-600 disabled:pointer-events-none disabled:opacity-40";

/**
 * Presentational `-` / `%` / `+` stepper shell. Shared by the main-window UI
 * zoom ({@link ZoomStepper}), the browser guest's per-page zoom, and the
 * document viewers' per-document zoom, which drive distinct mechanisms (CSS
 * `zoom` on the window, the guest's `setZoomFactor`, each engine's own scale)
 * but render the same control. Callers supply the readout and handlers.
 *
 * `readout` replaces the reset-to-100% button in the middle segment, for
 * callers that hang a menu of zoom levels off it instead. It is rendered as a
 * direct child of the divided row, so it should be a single element carrying
 * {@link zoomStepperSegmentClassName}.
 */
export function ZoomStepperControl({
  canZoomIn = true,
  canZoomOut = true,
  onReset,
  onZoomIn,
  onZoomOut,
  percent,
  readout,
  size = "default",
}: {
  canZoomIn?: boolean;
  canZoomOut?: boolean;
  onReset?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  percent?: number;
  readout?: ReactNode;
  size?: "default" | "sm";
}) {
  const compact = size === "sm";

  return (
    <div
      className={cn(
        "flex items-stretch divide-x divide-border overflow-hidden bg-card button-sheen text-card-foreground shadow-sm dark:bg-gray-700 dark:text-foreground dark:shadow-sm",
        compact ? "h-7 rounded-md" : "h-9 rounded-lg",
      )}
    >
      <button
        aria-label="Zoom out"
        className={cn(
          "flex items-center justify-center text-muted-foreground hover:text-foreground",
          zoomStepperSegmentClassName,
          compact ? "w-7" : "w-9",
        )}
        disabled={!canZoomOut}
        onClick={onZoomOut}
        type="button"
      >
        <MinusIcon className="size-4" />
      </button>
      {readout ?? (
        <button
          className={cn(
            "px-2 font-medium tabular-nums",
            zoomStepperSegmentClassName,
            compact ? "min-w-10 text-xs" : "min-w-12 text-sm",
          )}
          onClick={onReset}
          title="Reset to 100%"
          type="button"
        >
          {percent}%
        </button>
      )}
      <button
        aria-label="Zoom in"
        className={cn(
          "flex items-center justify-center text-muted-foreground hover:text-foreground",
          zoomStepperSegmentClassName,
          compact ? "w-7" : "w-9",
        )}
        disabled={!canZoomIn}
        onClick={onZoomIn}
        type="button"
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}

/**
 * Transient readout of the main-window UI zoom ({@link zoomAtom}): a corner pill
 * that appears on any zoom change (keyboard, wheel/pinch, or the settings
 * stepper) and fades out shortly after the last change, so the user gets
 * feedback that something changed without persistent chrome. Includes a reset
 * button; hovering the pill keeps it up so the button stays reachable. Meant to
 * mount once outside the zoomed root so it stays a constant size at any zoom.
 */
export function ZoomToast() {
  const [zoom, setZoom] = useAtom(zoomAtom);
  const [visible, setVisible] = useState(false);
  // Track the last-seen value so the toast fires only on an actual change, not
  // on mount (including the persisted non-1x value applied before first paint).
  const previousZoom = useRef(zoom);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (zoom === previousZoom.current) {
      return;
    }
    previousZoom.current = zoom;
    setVisible(true);
    // Re-armed on every change: clearing the prior timer means holding down zoom
    // keeps the pill up and it fades ZOOM_TOAST_MS after the last step.
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setVisible(false);
    }, ZOOM_TOAST_MS);
    return () => {
      clearTimeout(hideTimer.current);
    };
  }, [zoom]);

  return (
    <div
      className={cn(
        "fixed right-4 bottom-4 z-50 flex items-center gap-1 rounded-full border bg-popover py-1 pr-1 pl-3 text-xs font-medium text-popover-foreground shadow-md transition-opacity duration-200",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onMouseEnter={() => {
        clearTimeout(hideTimer.current);
      }}
      onMouseLeave={() => {
        clearTimeout(hideTimer.current);
        hideTimer.current = setTimeout(() => {
          setVisible(false);
        }, ZOOM_TOAST_MS);
      }}
    >
      <span className="tabular-nums">{Math.round(zoom * 100)}%</span>
      <button
        aria-label="Reset zoom to 100%"
        className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => {
          setZoom(1);
        }}
        title="Reset to 100%"
        type="button"
      >
        <ArrowCounterClockwiseIcon className="size-3.5" />
      </button>
    </div>
  );
}
