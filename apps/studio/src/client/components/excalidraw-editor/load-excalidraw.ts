import type * as Excalidraw from "@excalidraw/excalidraw";

/**
 * Loads Excalidraw, pointing it first at the fonts served beside the renderer
 * bundle (`excalidrawFonts` in electron.vite.config.ts) rather than its CDN,
 * which the renderer's policy refuses. Every place that loads the package goes
 * through here, since whichever loads it first fixes where its fonts come from.
 */
export function loadExcalidraw(): Promise<typeof Excalidraw> {
  window.EXCALIDRAW_ASSET_PATH = new URL(
    "/excalidraw-assets/",
    window.location.href,
  ).href;
  return import("@excalidraw/excalidraw");
}
