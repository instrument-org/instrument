/** Whether this renderer is the app-wide overlay's warm view. */
export function isStudioOverlayWindow() {
  return window.api.windowType === "studio-overlay";
}
