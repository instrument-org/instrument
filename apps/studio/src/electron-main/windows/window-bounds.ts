import {
  isWindowBoundsVisible,
  rememberWorkAreaFromMaximized,
  setWindowState,
  shrinkBelowAutoMaximize,
  type WindowBounds,
  type WindowStateName,
} from "@/electron-main/stores/window-state";
import { app, type BrowserWindow } from "electron";
import { debounce } from "radashi";

/**
 * Keeps the size and place a window comes back to.
 *
 * Every window that a person sizes wants this, and what makes it more than
 * `getBounds` on close is a list of moments where the bounds on offer are not
 * the ones to keep: a maximize animates through frames that read as ordinary
 * resizes, a minimized window reports nothing usable, Mission Control can
 * report a position on no display at all, and a quit destroys windows rather
 * than closing them. One copy of that, because a second window with its own
 * copy is a second window that learns each of those the hard way again.
 *
 * The caller says which events mean the window moved: they differ per window,
 * and the ones that also drive window chrome belong with the chrome.
 */
export function trackWindowBounds(
  window: BrowserWindow,
  name: WindowStateName,
) {
  // The size and position to come back to, which is the window's own only
  // while it is normal: maximize, fullscreen, minimize and bogus cross-display
  // move events all report bounds that would be useless to restore.
  let lastVisibleBounds: WindowBounds = window.getBounds();

  const save = () => {
    try {
      // A minimized window reports neither usable bounds nor, on Windows and
      // Linux, the maximized state it will come back to, so leave the state the
      // user last saw alone.
      if (window.isMinimized()) {
        return;
      }

      const isMaximized = window.isMaximized();
      const bounds = window.getBounds();
      if (isMaximized) {
        rememberWorkAreaFromMaximized(bounds);
      }

      // Sampled once the window has settled rather than from each resize event
      // it passes through: a maximize animates, and the frames along the way
      // are reported as ordinary resizes of a normal window, so reading them
      // records a nearly-maximized size as the one to come back to.
      if (isWindowNormal(window) && isWindowBoundsVisible(bounds)) {
        lastVisibleBounds = bounds;
      }

      setWindowState(name, {
        bounds: shrinkBelowAutoMaximize(lastVisibleBounds),
        isMaximized,
      });
    } catch {
      // Window may be destroyed
    }
  };

  const saveSoon = debounce({ delay: 500 }, save);

  const saveNow = () => {
    saveSoon.cancel();
    save();
  };

  window.on("close", saveNow);
  // Quitting never reaches the handler above: the quit teardown ends in
  // `app.exit`, which destroys windows instead of closing them. Without this,
  // a quit persists only what the debounce happened to have written, so the
  // last half second of moving, resizing, or unmaximizing is lost.
  app.on("before-quit", saveNow);
  window.on("closed", () => {
    app.off("before-quit", saveNow);
    saveNow();
  });

  return {
    /**
     * Where the window last was as an ordinary window, for a caller that has
     * to put it back there.
     */
    get lastVisibleBounds() {
      return lastVisibleBounds;
    },
    /** Record the window's state now, for a moment that will not come again. */
    saveNow,
    /** Record it once the window has settled. */
    saveSoon,
  };
}

export function isWindowNormal(window: BrowserWindow) {
  return (
    !window.isMaximized() && !window.isMinimized() && !window.isFullScreen()
  );
}
