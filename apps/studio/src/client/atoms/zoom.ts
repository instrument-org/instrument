import { type AppCommand } from "@/shared/app-command";
import {
  APP_ZOOM_KEY,
  clampZoom,
  steppedZoom,
  ZOOM_MAX,
  ZOOM_MIN,
} from "@/shared/zoom";
import { keptAtom } from "@/client/lib/kept-state";

/**
 * The UI zoom, applied as the CSS `zoom` property on each window's root.
 * Kept across launches and read before first paint, so the window opens at
 * its zoom without a flash. Clamped on read, so a corrupt value (e.g. 0,
 * which makes `calc(100vh / var(--app-zoom))` invalid and blanks the whole
 * window) can't brick the window. Independent of the agent browser's guest
 * content, which lives outside the zoomed root. The window reports changes to
 * the main process (macOS traffic-light position) so this stays a plain
 * view-state atom with no import-time side effects.
 */
export const zoomAtom = keptAtom<number>(
  "view",
  APP_ZOOM_KEY,
  1,
  (value, initial) =>
    typeof value === "number" && Number.isFinite(value)
      ? clampZoom(value)
      : initial,
);

/** The app's zoom after a zoom chord, from `factor`. */
export function appZoomAfter(
  command: AppCommand["type"],
  factor: number,
): number {
  if (command === "zoomReset") {
    return 1;
  }
  return steppedZoom({
    direction: command === "zoomIn" ? "in" : "out",
    factor,
    max: ZOOM_MAX,
    min: ZOOM_MIN,
  });
}
