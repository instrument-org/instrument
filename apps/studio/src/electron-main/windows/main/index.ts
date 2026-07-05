import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { captureServerException } from "@/electron-main/lib/capture-server-exception";
import { createContextMenu } from "@/electron-main/lib/context-menu";
import { openExternal } from "@/electron-main/lib/open-external";
import {
  getMainWindowBackgroundColor,
  getTitleBarOverlay,
} from "@/electron-main/lib/theme-utils";
import { studioURL } from "@/electron-main/lib/urls";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  getWindowState,
  isWindowBoundsVisible,
  setWindowState,
  type WindowBounds,
} from "@/electron-main/stores/window-state";
import {
  focusMainContents,
  goBack,
  goForward,
} from "@/electron-main/windows/main/controls";
import {
  getMainWindow,
  setMainWindow,
} from "@/electron-main/windows/main/instance";
import { is } from "@electron-toolkit/utils";
import { type BaseWindow, BrowserWindow } from "electron";
import path from "node:path";
import { debounce } from "radashi";

let wasWindowBlurred = false;

export async function createMainWindow({
  reveal = true,
}: {
  reveal?: boolean;
} = {}) {
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
    trafficLightPosition: { x: 12, y: 12 },
    ...(process.platform === "linux" && icon ? { icon } : {}),
    backgroundColor: getMainWindowBackgroundColor(),
    // On macOS keep the native NSWindow frame (titleBarStyle hiddenInset already
    // gives the chromeless look); a frameless window can't host modal sheets, so
    // native dialogs would fall back to the slow app-modal path. frame:false is
    // only needed for the custom title bar on Windows/Linux.
    frame: process.platform === "darwin" ? true : false,
    titleBarOverlay: getTitleBarOverlay(),
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

  // Bind the agent-browser `<webview>` attach lifecycle to this window's
  // webContents so the main process can grab guest WebContents (for CDP) as
  // the renderer pool mounts them.
  getBrowserViewManager()?.bindHost(mainWindow.webContents);
  // Keep the last normal, visible bounds so maximize/fullscreen/minimize and
  // bogus cross-display move events don't overwrite the restorable position.
  let lastVisibleBounds: WindowBounds = mainWindow.getBounds();

  const saveState = () => {
    try {
      const isMaximized = mainWindow.isMaximized();
      const bounds = mainWindow.getBounds();

      setWindowState({
        bounds:
          isWindowNormal(mainWindow) && isWindowBoundsVisible(bounds)
            ? bounds
            : lastVisibleBounds,
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

  mainWindow.on("closed", () => {
    debouncedSaveState.cancel();
    saveState();
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
    // Only focus current tab if the user was away from the app entirely,
    // not when switching between web contents views within the app
    if (wasWindowBlurred) {
      focusMainContents();
      wasWindowBlurred = false;
    }
  });
  mainWindow.on("ready-to-show", () => {
    if (!reveal) {
      return;
    }
    const window = getMainWindow();
    if (!window) {
      return;
    }

    showWindow(window);
  });

  // The path is cosmetic: the main window renders MainWindow based on its
  // `--windowType=main` argument, not on the route. It only needs a valid entry
  // URL, and the root path distinguishes it from the onboarding window.
  void mainWindow.loadURL(studioURL("/"));
  if (reveal) {
    showWindow(mainWindow);
  }

  if (getWindowState().isMaximized) {
    mainWindow.maximize();
  }

  setupWindowEventListeners({
    mainWindow,
    onResize: () => {
      const bounds = mainWindow.getBounds();
      const isNormal = isWindowNormal(mainWindow);

      if (isNormal && isWindowBoundsVisible(bounds)) {
        lastVisibleBounds = bounds;
      } else if (isNormal) {
        // Mission Control can briefly report an invalid post-drop position.
        mainWindow.setBounds(lastVisibleBounds);
        return;
      }

      debouncedSaveState();
    },
  });

  createContextMenu({ windowOrWebContentsView: mainWindow });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openExternal(details.url);
    return { action: "deny" };
  });

  return mainWindow;
}

export function updateMainWindowBackgroundColor() {
  const window = getMainWindow();
  if (window && !window.isDestroyed()) {
    window.setBackgroundColor(getMainWindowBackgroundColor());
  }
}

export function updateTitleBarOverlay() {
  const window = getMainWindow();
  if (
    window &&
    !window.isDestroyed() &&
    (process.platform === "linux" || process.platform === "win32")
  ) {
    window.setTitleBarOverlay(getTitleBarOverlay());
  }
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
  // Required on macOS and Linux
  // On macoS, unfocused resizes (e.g. Amethyst) won't be tracked
  // On Linux, maximize / unmaximize may not fire reliably
  mainWindow.on("will-resize", () => {
    onResize();
  });
  mainWindow.on("resize", () => {
    onResize();
  });
  mainWindow.on("move", () => {
    onResize();
  });

  // These were added when fixing Linux and may not be needed
  mainWindow.on("maximize", () => {
    onResize();
  });
  // cspell:ignore unmaximize
  mainWindow.on("unmaximize", () => {
    onResize();
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
