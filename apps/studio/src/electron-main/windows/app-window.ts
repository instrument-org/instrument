import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { getAppSession } from "@/electron-main/lib/app-session";
import { createContextMenu } from "@/electron-main/lib/context-menu";
import { guardNavigation } from "@/electron-main/lib/guard-navigation";
import { loadWindowURL } from "@/electron-main/lib/load-window-url";
import { openExternal } from "@/electron-main/lib/open-external";
import { isQuitApproved, requestQuitApproval } from "@/electron-main/lib/quit";
import { getBackgroundColor } from "@/electron-main/lib/theme-utils";
import { studioURL } from "@/electron-main/lib/urls";
import { bindAppWindowChords } from "@/electron-main/menus/app-window";
import { bindShortcutAccelerators } from "@/electron-main/menus/shortcuts";
import { publisher } from "@/electron-main/rpc/publisher";
import { getWorkspaceState } from "@/electron-main/stores/workspace/state";
import {
  getAppZoom,
  getWindowState,
} from "@/electron-main/stores/workspace/window-state";
import { getOnboardingWindow } from "@/electron-main/windows/onboarding";
import { showWhenReady } from "@/electron-main/windows/show-when-ready";
import { setTrafficLightForZoom } from "@/electron-main/windows/traffic-lights";
import { trackWindowBounds } from "@/electron-main/windows/window-bounds";
import { folderHref } from "@/shared/computer-href";
import { app, BrowserWindow } from "electron";
import { statSync } from "node:fs";
import path from "node:path";

/** The shape this window takes the first time, before it has been sized. */
const WINDOW_WIDTH = 1240;
const WINDOW_HEIGHT = 840;

let appWindow: BrowserWindow | null = null;

/**
 * What something outside the window asks it to put up: a screen by its
 * route, from a link, or a file handed to the app, which the window places
 * itself.
 */
export type AppWindowAsk =
  | { hostPath: string; type: "openFile" }
  | { href: string; type: "openScreen" };

/**
 * Asks made before the window's page was there to take them, in order:
 * several files handed over at once arrive one by one while the window is
 * still opening. The window's command stream starts empty at subscribe time,
 * so a command published while the renderer is still loading is lost; the
 * layout asks for these once it is up instead.
 */
let pendingAsks: AppWindowAsk[] = [];

/**
 * Whether the window's page has taken what waited for it, and so is listening
 * for asks as they come. A window that exists is not enough: its page may
 * still be loading, or reloading.
 */
let isTakingAsks = false;

export function getAppWindow(): BrowserWindow | null {
  return appWindow && !appWindow.isDestroyed() ? appWindow : null;
}

/**
 * Opens a file handed to the app from outside it, a double click, Open With,
 * or a drop on the Dock icon, in the window that is open or the one this
 * opens. A folder opens in the folder view, standing in it.
 */
export function openAppFile(hostPath: string) {
  if (isFolder(hostPath)) {
    openAppScreen(folderHref(hostPath));
    return;
  }
  askAppWindow({ hostPath, type: "openFile" });
}

function isFolder(hostPath: string) {
  try {
    return statSync(hostPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Puts a screen of the window up, by its route: in the window that is open,
 * or in the one this opens. What a link from outside the app asks for.
 */
export function openAppScreen(href: string) {
  askAppWindow({ href, type: "openScreen" });
}

/**
 * The app window: the inbox of chats, the tasks they started, and the tabs
 * the user and the agents open. Its renderer hosts every task's browser guest.
 */
export function openAppWindow(): BrowserWindow {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.focus();
    return appWindow;
  }

  const remembered = getWindowState("app", {
    height: WINDOW_HEIGHT,
    width: WINDOW_WIDTH,
  });

  appWindow = new BrowserWindow({
    ...remembered.bounds,
    backgroundColor: getBackgroundColor(),
    // On macOS the native NSWindow frame is kept, since `hiddenInset` already
    // gives the chromeless look and a frameless window cannot host modal
    // sheets. Everywhere else the frame is what draws a title bar above this
    // window's own bar, so it goes and the renderer draws the window controls
    // (see WindowControls).
    frame: process.platform === "darwin",
    minHeight: 520,
    minWidth: 900,
    show: false,
    title: "Instrument",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      additionalArguments: ["--windowType=app"],
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
      session: getAppSession(),
      // The Browser tab is a renderer-hosted `<webview>`, like a task's browser.
      webviewTag: true,
    },
  });

  const tracked = trackWindowBounds(appWindow, "app");
  // Every way this window changes shape. `will-resize` and `move` are here
  // because macOS does not report a resize the user did not drive (a tiling
  // manager) and Linux does not reliably report maximize on its own.
  const sized = () => {
    tracked.saveSoon();
  };
  appWindow.on("will-resize", sized);
  appWindow.on("resize", sized);
  appWindow.on("move", sized);
  // Also told to the renderer, which draws this window's own maximize and
  // restore glyph and, on an X11 session, the hairline that has to go when an
  // edge sits against the screen. The OS drives these as well as the buttons
  // do: a snap, a double click on the bar, Win+Up.
  const changedShape = () => {
    sized();
    publisher.publish("window.state-changed", null);
  };
  appWindow.on("maximize", changedShape);
  appWindow.on("unmaximize", changedShape);
  appWindow.on("enter-full-screen", changedShape);
  appWindow.on("leave-full-screen", changedShape);

  // Center the lights in the window bar for the zoom the renderer last
  // reported, so they are in place for the first paint instead of jumping once
  // this window mounts and syncs its own. Set here rather than through the
  // `trafficLightPosition` option, which only applies to frameless windows; this
  // one keeps its macOS frame.
  setTrafficLightForZoom(appWindow, getAppZoom());

  showWhenReady(appWindow, () => {
    // Maximized only once there is a window to maximize: on Windows and Linux
    // maximizing one that has not been shown is itself what shows it, which
    // would put this window up before its first paint.
    if (remembered.isMaximized) {
      appWindow?.maximize();
    }
    appWindow?.show();
  });

  // Closing the last window the user can see quits the app, so the
  // running-agent warning has to happen here, while the window still exists.
  // Asking after the fact would destroy the window first and leave a canceled
  // quit with a running process the user can't get back to.
  appWindow.on("close", (event) => {
    if (isQuitApproved() || hasVisibleWindowOtherThan(appWindow)) {
      return;
    }
    event.preventDefault();
    void requestQuitApproval().then((approved) => {
      if (approved && appWindow && !appWindow.isDestroyed()) {
        appWindow.close();
      }
    });
  });

  // A page loading afresh is not listening yet; what is asked meanwhile waits
  // for it to ask again.
  appWindow.webContents.on(
    "did-start-navigation",
    ({ isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) {
        isTakingAsks = false;
      }
    },
  );
  appWindow.webContents.on("render-process-gone", () => {
    isTakingAsks = false;
  });

  appWindow.on("closed", () => {
    appWindow = null;
    isTakingAsks = false;
    publisher.publish("window.focus-changed", null);
    // The window is already out of the list by now, so nothing to exclude.
    if (!hasVisibleWindowOtherThan(null)) {
      app.quit();
    }
  });

  appWindow.on("focus", () => {
    publisher.publish("window.focus-changed", null);
  });

  appWindow.webContents.setWindowOpenHandler((details) => {
    void openExternal(details.url);
    return { action: "deny" };
  });

  guardNavigation(appWindow.webContents);
  bindAppWindowChords(appWindow.webContents);
  // The Developer menu's chords, which would otherwise reach this window only
  // when the page leaves the key unhandled.
  bindShortcutAccelerators(appWindow.webContents, {
    group: "Developer",
  });

  // A trackpad swipe or a mouse thumb button asks for history, and both reach
  // the main process rather than the page; the window's own router answers.
  appWindow.on("swipe", (_event, direction) => {
    if (direction === "left") {
      publisher.publish("window.command", "back");
    } else if (direction === "right") {
      publisher.publish("window.command", "forward");
    }
  });
  appWindow.on("app-command", (event, command) => {
    if (command === "browser-backward") {
      event.preventDefault();
      publisher.publish("window.command", "back");
    } else if (command === "browser-forward") {
      event.preventDefault();
      publisher.publish("window.command", "forward");
    }
  });

  // Every browser guest, the user's tabs and the tasks' pages alike, is
  // mounted by this window's pool and driven by the manager, so a task can be
  // handed a tab by target id.
  getBrowserViewManager()?.bindHost(appWindow.webContents);

  loadWindowURL(appWindow.webContents, studioURL("/chats/"));

  createContextMenu({
    browserWindow: appWindow,
    onOpenLink: (options) => {
      publisher.publish("window.open-menu-link", options);
    },
  });

  return appWindow;
}

/**
 * What waits for the window without taking it: what onboarding names, so
 * the person knows it opens once they are through.
 */
export function waitingAppWindowAsks(): readonly AppWindowAsk[] {
  return pendingAsks;
}

/** What was asked of the window while it was opening, once, then nothing. */
export function takePendingAppWindowAsks(): AppWindowAsk[] {
  const asks = pendingAsks;
  pendingAsks = [];
  isTakingAsks = true;
  return asks;
}

export function updateAppWindowBackgroundColor() {
  if (appWindow && !appWindow.isDestroyed()) {
    appWindow.setBackgroundColor(getBackgroundColor());
  }
}

function askAppWindow(ask: AppWindowAsk) {
  const window = getAppWindow();
  if (window) {
    window.focus();
    if (isTakingAsks) {
      publisher.publish("window.command", ask);
    } else {
      pendingAsks.push(ask);
    }
    return;
  }
  pendingAsks.push(ask);
  publisher.publish("window.asks-waiting", null);
  // An ask that launched the app arrives before it is ready to make a window;
  // boot opens this one itself, and the ask waits for it. So does one made
  // before onboarding is finished, including its steps after the provider is
  // set up: finishing it opens this window, which then takes it.
  if (
    app.isReady() &&
    getWorkspaceState().get("hasCompletedProviderSetup") &&
    !getOnboardingWindow()
  ) {
    openAppWindow();
  }
}

/**
 * Whether the user can still see a window other than this one. A hidden window
 * (an offscreen one drawing a file's picture) is not a window to be left with:
 * `window-all-closed` counts it and would not fire, leaving a running process
 * with nothing on screen and, outside macOS, no dock or tray to bring one back
 * from.
 */
function hasVisibleWindowOtherThan(exclude: BrowserWindow | null) {
  return BrowserWindow.getAllWindows().some(
    (window) =>
      window !== exclude && !window.isDestroyed() && window.isVisible(),
  );
}
