import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { type BrowserWindow } from "electron";

// Height of the macOS traffic-light cluster, used to vertically center it within
// the band the window's own chrome draws behind it.
const TRAFFIC_LIGHT_CLUSTER_HEIGHT = 16;
const TRAFFIC_LIGHT_X = 12;

/**
 * Centers a window's macOS traffic lights for the zoom its UI is drawn at.
 *
 * Every window that puts chrome behind the buttons keeps a TOOLBAR_HEIGHT band
 * across its top, and the renderer scales that band with CSS `zoom`. The buttons
 * are drawn by the system over the web contents in real pixels, so they don't
 * scale with it: the window has to re-center them each time the renderer reports
 * a new zoom, or they sit high in a tall band and hang out of a short one.
 */
export function setTrafficLightForZoom(
  window: BrowserWindow | null,
  zoom: number,
) {
  if (!window || window.isDestroyed() || process.platform !== "darwin") {
    return;
  }
  window.setWindowButtonPosition(trafficLightPositionForZoom(zoom));
}

/** Where the cluster sits in a band drawn at `zoom`, apart from any window. */
export function trafficLightPositionForZoom(zoom: number) {
  return {
    x: TRAFFIC_LIGHT_X,
    y: Math.max(
      0,
      Math.round((TOOLBAR_HEIGHT * zoom - TRAFFIC_LIGHT_CLUSTER_HEIGHT) / 2),
    ),
  };
}
