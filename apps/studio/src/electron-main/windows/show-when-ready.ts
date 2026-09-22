import type { BrowserWindow } from "electron";

/**
 * Put a window made with `show: false` on screen once it has painted, or right
 * away where waiting for that never ends.
 *
 * Elsewhere `ready-to-show` spares the user a blank frame before the first
 * paint. On Linux it can never fire: under Wayland with software compositing a
 * surface that is not mapped is never given a frame, so the renderer never
 * paints, the event never comes, and the window stays hidden with a live page
 * behind it. The window's `backgroundColor` stands in for the first paint
 * there, as it does for the main window, which is shown on creation.
 */
export function showWhenReady(window: BrowserWindow, show: () => void) {
  if (process.platform === "linux") {
    show();
    return;
  }
  window.once("ready-to-show", show);
}
