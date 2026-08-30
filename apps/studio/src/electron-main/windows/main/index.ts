import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { createContextMenu } from "@/electron-main/lib/context-menu";
import { guardNavigation } from "@/electron-main/lib/guard-navigation";
import { loadWindowURL } from "@/electron-main/lib/load-window-url";
import { openExternal } from "@/electron-main/lib/open-external";
import {
  isQuitApproved,
  requestQuitApproval,
} from "@/electron-main/lib/quit-guard";
import { getMainWindowBackgroundColor } from "@/electron-main/lib/theme-utils";
import { studioURL } from "@/electron-main/lib/urls";
import { bindShortcutAccelerators } from "@/electron-main/menus/shortcuts";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  getMainWindowZoom,
  getWindowState,
  isWindowBoundsVisible,
  rememberWorkAreaFromMaximized,
  setWindowState,
  shrinkBelowAutoMaximize,
  type WindowBounds,
} from "@/electron-main/stores/window-state";
import {
  focusMainContents,
  goBack,
  goForward,
  setTrafficLightForZoom,
} from "@/electron-main/windows/main/controls";
import {
  clearMainWindow,
  getMainWindow,
  getOrCreateMainWindow,
  setMainWindow,
} from "@/electron-main/windows/main/instance";
import { is } from "@electron-toolkit/utils";
import { app, type BaseWindow, BrowserWindow } from "electron";
import path from "node:path";
import { debounce } from "radashi";

let wasWindowBlurred = false;
// Whether the session being restored left the window maximized, held until the
// window is first put on screen. Applying it at creation would defeat a window
// created to stay hidden: on Windows and Linux, maximizing a window that has
// not been shown is what shows it.
let hasMaximizedRestoreToApply = false;

export async function createMainWindow({
  reveal = true,
}: {
  reveal?: boolean;
} = {}) {
  const mainWindow = await getOrCreateMainWindow(createMainWindowInstance);
  if (reveal) {
    if (hasMaximizedRestoreToApply) {
      hasMaximizedRestoreToApply = false;
      mainWindow.maximize();
    }
    showWindow(mainWindow);
  }
  return mainWindow;
}

/**
 * Put a usable main window on screen, recreating it if none is left. Outside
 * macOS a running app with no window is unreachable -- no dock icon, no menu
 * bar, and the single-instance lock turns a fresh launch into a no-op -- so any
 * path that can strand the process has to be able to summon one back.
 */
export async function ensureMainWindowVisible() {
  const existing = getMainWindow();
  if (!existing) {
    return createMainWindow();
  }

  if (existing.isMinimized()) {
    existing.restore();
  }
  if (!existing.isVisible()) {
    existing.show();
  }
  existing.focus();
  return existing;
}

export function updateMainWindowBackgroundColor() {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) {
    window.setBackgroundColor(getMainWindowBackgroundColor());
  }
}

async function createMainWindowInstance() {
  let icon: string | undefined;
  try {
    const iconModule = await import("../../../../resources/icon.png?asset");
    icon = iconModule.default;
  } catch (error) {
    captureServerException(
      new Error("Failed to load app icon", { cause: error }),
    );
  }

  const mainWindow = new BrowserWindow({
    ...getWindowState().bounds,
    minHeight: 480,
    minWidth: 720,
    show: false,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    ...(process.platform === "linux" && icon ? { icon } : {}),
    backgroundColor: getMainWindowBackgroundColor(),
    // On macOS keep the native NSWindow frame (titleBarStyle hiddenInset already
    // gives the chromeless look); a frameless window can't host modal sheets, so
    // native dialogs would fall back to the slow app-modal path. frame:false is
    // only needed for the custom title bar on Windows/Linux, which draws its own
    // window controls (see WindowControls) rather than using the native overlay.
    frame: process.platform === "darwin" ? true : false,
    webPreferences: {
      additionalArguments: ["--windowType=main"],
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
      // Enables renderer-hosted `<webview>` guests for the agent-browser pool.
      webviewTag: true,
    },
  });

  setMainWindow(mainWindow);

  bindShortcutAccelerators(mainWindow.webContents);

  // Center the traffic lights for the zoom the renderer last reported, so they
  // sit in the boot shell's toolbar correctly instead of jumping once the
  // renderer mounts and syncs its zoom. This runs after creation rather than
  // through the `trafficLightPosition` option, which only applies to frameless
  // windows; on macOS this one keeps its frame (see `frame` above).
  setTrafficLightForZoom(getMainWindowZoom());

  // Bind the agent-browser `<webview>` attach lifecycle to this window's
  // webContents so the main process can grab guest WebContents (for CDP) as
  // the renderer pool mounts them.
  getBrowserViewManager()?.bindHost(mainWindow.webContents);
  // The size and position to come back to, which is the window's own only
  // while it is normal: maximize, fullscreen, minimize and bogus cross-display
  // move events all report bounds that would be useless to restore.
  let lastVisibleBounds: WindowBounds = mainWindow.getBounds();

  const saveState = () => {
    try {
      // A minimized window reports neither usable bounds nor, on Windows and
      // Linux, the maximized state it will come back to, so leave the state the
      // user last saw alone.
      if (mainWindow.isMinimized()) {
        return;
      }

      const isMaximized = mainWindow.isMaximized();
      const bounds = mainWindow.getBounds();
      if (isMaximized) {
        rememberWorkAreaFromMaximized(bounds);
      }

      // Sampled once the window has settled rather than from each resize event
      // it passes through: a maximize animates, and the frames along the way
      // are reported as ordinary resizes of a normal window, so reading them
      // records a nearly-maximized size as the one to come back to.
      if (isWindowNormal(mainWindow) && isWindowBoundsVisible(bounds)) {
        lastVisibleBounds = bounds;
      }

      setWindowState({
        bounds: shrinkBelowAutoMaximize(lastVisibleBounds),
        isMaximized,
      });
    } catch {
      // Window may be destroyed
    }
  };

  const debouncedSaveState = debounce({ delay: 500 }, saveState);

  mainWindow.on("close", () => {
    debouncedSaveState.cancel();
    saveState();
  });

  // Quitting never reaches the handler above: the quit teardown ends in
  // `app.exit`, which destroys windows instead of closing them. Without this,
  // a quit persists only what the debounce happened to have written, so the
  // last half second of moving, resizing, or unmaximizing is lost.
  const saveStateBeforeQuit = () => {
    debouncedSaveState.cancel();
    saveState();
  };
  app.on("before-quit", saveStateBeforeQuit);

  // Closing the last window quits the app (see `window-all-closed`), so the
  // running-agent warning has to happen here, while the window still exists.
  // Asking after the fact would destroy the window first and leave a canceled
  // quit with a running process the user can't get back to.
  mainWindow.on("close", (event) => {
    if (isQuitApproved() || !isLastWindow()) {
      return;
    }
    event.preventDefault();
    void requestQuitApproval().then((approved) => {
      if (approved && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
    });
  });

  mainWindow.on("closed", () => {
    app.off("before-quit", saveStateBeforeQuit);
    debouncedSaveState.cancel();
    saveState();
    clearMainWindow(mainWindow);
  });

  // Windows delivers mouse thumb buttons (back/forward) as native app-commands
  // rather than DOM mouse events, so route them through the same history helpers
  // the menu uses and preventDefault to stop Chromium's own navigation/reload.
  mainWindow.on("app-command", (event, command) => {
    if (command === "browser-backward") {
      event.preventDefault();
      goBack();
    } else if (command === "browser-forward") {
      event.preventDefault();
      goForward();
    }
  });

  mainWindow.on("blur", () => {
    wasWindowBlurred = true;
  });
  mainWindow.on("focus", () => {
    publisher.publish("window.focus-changed", null);
    // Only focus the current tab when the user returns to the app from
    // elsewhere, not on focus churn within the window.
    if (wasWindowBlurred) {
      focusMainContents();
      wasWindowBlurred = false;
    }
  });

  // The path is cosmetic: the main window renders MainWindow based on its
  // `--windowType=main` argument, not on the route. It only needs a valid entry
  // URL, and the root path distinguishes it from the onboarding window.
  loadWindowURL(mainWindow.webContents, studioURL("/"));

  hasMaximizedRestoreToApply = getWindowState().isMaximized;

  setupWindowEventListeners({
    mainWindow,
    onResize: () => {
      if (
        isWindowNormal(mainWindow) &&
        !isWindowBoundsVisible(mainWindow.getBounds())
      ) {
        // Mission Control can briefly report an invalid post-drop position.
        mainWindow.setBounds(lastVisibleBounds);
        return;
      }

      debouncedSaveState();
    },
  });

  createContextMenu({ browserWindow: mainWindow });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternal(details.url);
    return { action: "deny" };
  });

  guardNavigation(mainWindow.webContents);

  return mainWindow;
}

// Whether closing this window ends the app. A window is still listed while its
// own `close` is being handled, so the last one sees a count of 1.
function isLastWindow() {
  return BrowserWindow.getAllWindows().length <= 1;
}

function isWindowNormal(mainWindow: BrowserWindow) {
  return (
    !mainWindow.isMaximized() &&
    !mainWindow.isMinimized() &&
    !mainWindow.isFullScreen()
  );
}

function setupWindowEventListeners({
  mainWindow,
  onResize,
}: {
  mainWindow: BrowserWindow;
  onResize: () => void;
}) {
  // A move between displays can change the scale factor the Linux window border
  // insets itself for, and that shows up here. Debounced because this fires
  // continuously through a drag, and nothing downstream needs it mid-drag.
  const publishResizedState = debounce({ delay: 100 }, () => {
    publisher.publish("window.state-changed", null);
  });

  // Required on macOS and Linux
  // On macOS, unfocused resizes (e.g. Amethyst) won't be tracked
  // On Linux, maximize / unmaximize may not fire reliably
  mainWindow.on("will-resize", () => {
    onResize();
  });
  mainWindow.on("resize", () => {
    onResize();
    publishResizedState();
  });
  mainWindow.on("move", () => {
    onResize();
  });

  // These were added when fixing Linux and may not be needed. The custom
  // window controls (Windows/Linux, and macOS when force-shown) read the
  // maximized state, so republish it here to keep the restore/maximize glyph
  // in sync with OS-driven maximize (snap, double-click, Win+Up).
  mainWindow.on("maximize", () => {
    onResize();
    publisher.publish("window.state-changed", null);
  });
  mainWindow.on("unmaximize", () => {
    onResize();
    publisher.publish("window.state-changed", null);
  });

  // The Linux window border (see WindowBorder) hides itself whenever an edge
  // sits against the screen, so it needs the fullscreen transitions too.
  mainWindow.on("enter-full-screen", () => {
    publisher.publish("window.state-changed", null);
  });
  mainWindow.on("leave-full-screen", () => {
    publisher.publish("window.state-changed", null);
  });
}

function showWindow(baseWindow: BaseWindow) {
  if (!baseWindow.isVisible()) {
    if (is.dev) {
      // Prevents the window from gaining focus every time it reloads in dev
      baseWindow.showInactive();
    } else {
      baseWindow.show();
    }
  }
}
