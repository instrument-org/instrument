import { shouldUseDarkMode } from "@/electron-main/lib/theme-utils";
import { CAPTION_HEIGHT } from "@/shared/constants";
import { type BrowserWindow } from "electron";

/**
 * The system's own minimize, maximize and close, off the Mac, over the ground
 * above an app window's card. They keep the system's size, so only their
 * height follows the zoom, which keeps them centered on that ground.
 */
export function captionOverlay(zoom: number, isFocused = true) {
  const [focused, behind] = shouldUseDarkMode()
    ? ["#d6d3d1", "#78716c"]
    : ["#44403c", "#a8a29e"];
  return {
    color: "#00000000",
    height: Math.round(CAPTION_HEIGHT * zoom),
    symbolColor: isFocused ? focused : behind,
  };
}

/** Brings an app window's caption buttons up to date with its zoom, theme and focus. */
export function syncCaptionOverlay(window: BrowserWindow, zoom: number) {
  if (process.platform !== "darwin" && !window.isDestroyed()) {
    window.setTitleBarOverlay(captionOverlay(zoom, window.isFocused()));
  }
}
