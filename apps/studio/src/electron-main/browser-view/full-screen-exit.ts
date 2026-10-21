import type { BrowserWindow } from "electron";

import { log } from "./log";

/**
 * Whether a window leaving macOS full screen has to tell its pages so again.
 *
 * A page leaving HTML full screen (Esc, the page's own exit button) starts
 * the window's animated exit and then tells the guest and the window's
 * document that full screen is over. Electron answers that while the
 * animation runs, and an HTML full screen mid-transition still counts as
 * granted (`IsFullscreenForTabOrPending`), so both are told it still is, and
 * nothing tells them otherwise once the animation ends. The page is left in
 * full screen inside an ordinary window, and its exit asks Electron for a
 * change it already made, so nothing happens. Resizing the window makes
 * Chromium send each page its state again, which by then says full screen
 * is over.
 */
export function createFullScreenExitTracker() {
  let pageWasFullScreen = false;
  return {
    /** The window's `enter-html-full-screen`: a page in it went full screen. */
    pageEntered() {
      pageWasFullScreen = true;
    },
    /** The window's `leave-full-screen`; true when a page had been full screen in it. */
    windowLeft(): boolean {
      const resync = pageWasFullScreen;
      pageWasFullScreen = false;
      return resync;
    },
  };
}

const RESIZE_SETTLE_MS = 50;

/**
 * Resizes the window by a pixel and back after it leaves full screen that a
 * page took it into, so its pages learn full screen is over; see
 * {@link createFullScreenExitTracker}. macOS only: the stale state comes
 * from its animated transition.
 */
export function resyncPagesAfterFullScreen(win: BrowserWindow) {
  if (process.platform !== "darwin") {
    return;
  }
  const tracker = createFullScreenExitTracker();
  win.on("enter-html-full-screen", () => {
    log.info("full screen: a page entered it");
    tracker.pageEntered();
  });
  win.on("leave-html-full-screen", () => {
    log.info("full screen: a page left it");
  });
  win.on("leave-full-screen", () => {
    if (!tracker.windowLeft()) {
      return;
    }
    log.info("full screen: resyncing pages after the window left it");
    setTimeout(() => {
      if (win.isDestroyed() || win.isFullScreen()) {
        return;
      }
      const [width = 0, height = 0] = win.getContentSize();
      win.setContentSize(width, height + 1);
      setTimeout(() => {
        if (!win.isDestroyed() && !win.isFullScreen()) {
          win.setContentSize(width, height);
        }
      }, RESIZE_SETTLE_MS);
    }, 0);
  });
}
