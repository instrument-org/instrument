/**
 * An app command sent from the main process (native menus / accelerators) to
 * the renderers, streamed over the one command bus: the app's own zoom, which
 * the renderer owns as CSS `zoom`.
 */
export type AppCommand =
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "zoomReset" };
