import { createContextMenu } from "@/electron-main/lib/context-menu";
import { guardNavigation } from "@/electron-main/lib/guard-navigation";
import { openExternal } from "@/electron-main/lib/open-external";
import { studioURL } from "@/electron-main/lib/urls";
import { publisher } from "@/electron-main/rpc/publisher";
import { BrowserWindow, screen } from "electron";
import path from "node:path";

const OVERLAY_WIDTH = 640;
// What it opens at, before the renderer has measured itself. Close to the
// resting palette so the first paint does not visibly resize.
const OVERLAY_HEIGHT = 320;
// Enough for the composer plus a row, so a resize can never collapse the panel
// to something with nothing usable in it.
const MIN_OVERLAY_HEIGHT = 140;
// How far down the display the panel sits. Spotlight-like: nearer the top than
// the middle, so it lands where the eye already is rather than over the work.
const OVERLAY_TOP_FRACTION = 0.18;

let overlayWindow: BrowserWindow | null = null;

/**
 * Tear the panel down for good. The app quits when its last window closes, and
 * a hidden window still counts as one, so the overlay must not outlive the main
 * window or closing that window would leave the app running with nothing shown.
 */
export function destroyQuickCaptureOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.destroy();
  }
  overlayWindow = null;
}

export function getQuickCaptureOverlayWindow(): BrowserWindow | null {
  return overlayWindow;
}

export function hideQuickCaptureOverlay() {
  if (
    overlayWindow &&
    !overlayWindow.isDestroyed() &&
    overlayWindow.isVisible()
  ) {
    overlayWindow.hide();
    // Said out loud, because the renderer cannot tell being dismissed from
    // being covered: a native file dialog makes the page hidden too, and
    // resetting on that threw away the prompt someone was part way through.
    publisher.publish("overlay.dismissed", null);
  }
}

/**
 * Follow the renderer's measured content, keeping the top edge where it is. The
 * panel is a fixed anchor on screen; growing downward from a steady top reads as
 * the same surface opening up, where re-centering reads as a new one.
 *
 * The renderer drives this because only it knows how tall the content became --
 * a result list filling in, a file attached to the composer, a transcript
 * loading -- and all of those have to move the window, not scroll inside a box
 * the wrong size for them.
 */
export function setQuickCaptureOverlayHeight(height: number) {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return;
  }

  const { x, y } = positionOf(overlayWindow);
  const { workArea } = screen.getDisplayNearestPoint({ x, y });
  // Never taller than the room below where it sits, so the bottom of the panel
  // cannot end up off the screen.
  const maxHeight = Math.max(
    MIN_OVERLAY_HEIGHT,
    workArea.y + workArea.height - y - 24,
  );
  const next = Math.round(
    Math.min(Math.max(height, MIN_OVERLAY_HEIGHT), maxHeight),
  );

  if (next === heightOf(overlayWindow)) {
    return;
  }

  overlayWindow.setBounds({ height: next, width: OVERLAY_WIDTH, x, y });
}

/**
 * Show the panel, or hide it if it is already up. Hiding rather than closing is
 * what makes the hotkey feel like a toggle onto one dependable surface: the
 * renderer keeps its state, so summoning it again lands back where it was.
 */
export function toggleQuickCaptureOverlay() {
  const existing = getOrCreateOverlayWindow();

  if (existing.isVisible()) {
    hideQuickCaptureOverlay();
    return;
  }

  // Always the same place, on whichever display the pointer is on. Dragging it
  // is for getting it off whatever it is covering right now, not for choosing
  // where it lives, so the next summon starts from the usual spot.
  const height = heightOf(existing);
  const cursor = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursor);
  existing.setPosition(
    workArea.x + Math.round((workArea.width - OVERLAY_WIDTH) / 2),
    workArea.y + Math.round(workArea.height * OVERLAY_TOP_FRACTION),
  );
  existing.setSize(OVERLAY_WIDTH, height);
  existing.show();
  existing.focus();
}

function getOrCreateOverlayWindow(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  overlayWindow = new BrowserWindow({
    alwaysOnTop: true,
    // Transparent so the panel is a shape we draw rather than a rectangle the
    // platform draws for us: the rounding, the border and the background are
    // all the renderer's.
    backgroundColor: "#00000000",
    frame: false,
    fullscreenable: false,
    hasShadow: false,
    height: OVERLAY_HEIGHT,
    maximizable: false,
    minimizable: false,
    resizable: false,
    // macOS masks a frameless window to the system corner radius, which clips
    // ours wherever the two disagree -- and they disagree more on recent
    // versions, which is what ate the border at each corner. Off, the shape is
    // entirely the panel's own CSS.
    roundedCorners: false,
    show: false,
    skipTaskbar: true,
    title: "Quick capture",
    transparent: true,
    // The non-activating panel style: floats above other apps and over
    // full-screen ones without taking activation away from what is behind it.
    type: process.platform === "darwin" ? "panel" : undefined,
    webPreferences: {
      additionalArguments: ["--windowType=overlay"],
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
    },
    width: OVERLAY_WIDTH,
  });

  // Above full-screen apps, and present on whichever space is current rather
  // than pinned to the one it was created on.
  overlayWindow.setVisibleOnAllWorkspaces(true, {
    visibleOnFullScreen: true,
  });
  overlayWindow.setAlwaysOnTop(true, "floating");

  // Deliberately no hide-on-blur, though a launcher usually has one. Attaching
  // a file takes focus away by definition -- the native open dialog is another
  // window, and dragging a file in means clicking in Finder first -- so
  // dismissing on blur makes attachments impossible to reach. Escape and the
  // hotkey are the ways out.

  overlayWindow.on("closed", () => {
    overlayWindow = null;
  });

  overlayWindow.webContents.setWindowOpenHandler((details) => {
    void openExternal(details.url);
    return { action: "deny" };
  });

  guardNavigation(overlayWindow.webContents);

  void overlayWindow.loadURL(studioURL("/overlay"));

  createContextMenu({ browserWindow: overlayWindow });

  return overlayWindow;
}

function heightOf(window: BrowserWindow) {
  const [, height = OVERLAY_HEIGHT] = window.getSize();
  return height;
}

// Electron hands these back as tuples, which read as possibly-undefined under
// the strict index checks this package builds with.
function positionOf(window: BrowserWindow) {
  const [x = 0, y = 0] = window.getPosition();
  return { x, y };
}
