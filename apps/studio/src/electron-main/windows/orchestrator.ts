import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { createContextMenu } from "@/electron-main/lib/context-menu";
import { guardNavigation } from "@/electron-main/lib/guard-navigation";
import { loadWindowURL } from "@/electron-main/lib/load-window-url";
import { openExternal } from "@/electron-main/lib/open-external";
import {
  isQuitApproved,
  requestQuitApproval,
} from "@/electron-main/lib/quit-guard";
import { getBackgroundColor } from "@/electron-main/lib/theme-utils";
import { studioURL } from "@/electron-main/lib/urls";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  getAppZoom,
  getWindowState,
} from "@/electron-main/stores/window-state";
import { setTrafficLightForZoom } from "@/electron-main/windows/traffic-lights";
import { trackWindowBounds } from "@/electron-main/windows/window-bounds";
import { app, BrowserWindow } from "electron";
import path from "node:path";

/** The shape this window takes the first time, before it has been sized. */
const ORCHESTRATOR_WIDTH = 1240;
const ORCHESTRATOR_HEIGHT = 840;

let orchestratorWindow: BrowserWindow | null = null;

export function getOrchestratorWindow(): BrowserWindow | null {
  return orchestratorWindow && !orchestratorWindow.isDestroyed()
    ? orchestratorWindow
    : null;
}

/**
 * The window where the user talks to the orchestrator: one conversation and
 * the tasks it created beneath. A second window on the same renderer bundle,
 * the way the onboarding window is, so the current app is left as it is. Its
 * tasks run in the main window's process and browser pool, so this window
 * needs the main one open beside it.
 */
export function openOrchestratorWindow(): BrowserWindow {
  if (orchestratorWindow && !orchestratorWindow.isDestroyed()) {
    orchestratorWindow.focus();
    return orchestratorWindow;
  }

  const remembered = getWindowState("orchestrator", {
    height: ORCHESTRATOR_HEIGHT,
    width: ORCHESTRATOR_WIDTH,
  });

  orchestratorWindow = new BrowserWindow({
    ...remembered.bounds,
    backgroundColor: getBackgroundColor(),
    // On macOS the native NSWindow frame is kept, since `hiddenInset` already
    // gives the chromeless look and a frameless window cannot host modal
    // sheets. Everywhere else the frame is what draws a title bar above this
    // window's own bar, so it goes and the renderer draws the window controls
    // (see WindowControls), as the classic window does.
    frame: process.platform === "darwin",
    minHeight: 520,
    minWidth: 900,
    show: false,
    title: "Instrument",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      additionalArguments: ["--windowType=orchestrator"],
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
      // The Browser tab is a renderer-hosted `<webview>`, like a task's browser.
      webviewTag: true,
    },
  });

  const tracked = trackWindowBounds(orchestratorWindow, "orchestrator");
  // Every way this window changes shape. `will-resize` and `move` are here
  // because macOS does not report a resize the user did not drive (a tiling
  // manager) and Linux does not reliably report maximize on its own.
  const sized = () => {
    tracked.saveSoon();
  };
  orchestratorWindow.on("will-resize", sized);
  orchestratorWindow.on("resize", sized);
  orchestratorWindow.on("move", sized);
  // Also told to the renderer, which draws this window's own maximize and
  // restore glyph and, on an X11 session, the hairline that has to go when an
  // edge sits against the screen. The OS drives these as well as the buttons
  // do: a snap, a double click on the bar, Win+Up.
  const changedShape = () => {
    sized();
    publisher.publish("window.state-changed", null);
  };
  orchestratorWindow.on("maximize", changedShape);
  orchestratorWindow.on("unmaximize", changedShape);
  orchestratorWindow.on("enter-full-screen", changedShape);
  orchestratorWindow.on("leave-full-screen", changedShape);

  // Center the lights in the window bar for the zoom the renderer last
  // reported, so they are in place for the first paint instead of jumping once
  // this window mounts and syncs its own. Set here rather than through the
  // `trafficLightPosition` option, which only applies to frameless windows; this
  // one keeps its macOS frame, as the main window does.
  setTrafficLightForZoom(orchestratorWindow, getAppZoom());

  orchestratorWindow.once("ready-to-show", () => {
    // Maximized only once there is a window to maximize: on Windows and Linux
    // maximizing one that has not been shown is itself what shows it, which
    // would put this window up before its first paint.
    if (remembered.isMaximized) {
      orchestratorWindow?.maximize();
    }
    orchestratorWindow?.show();
  });

  // Closing the last window the user can see quits the app, so the
  // running-agent warning has to happen here, while the window still exists.
  // Asking after the fact would destroy the window first and leave a canceled
  // quit with a running process the user can't get back to.
  orchestratorWindow.on("close", (event) => {
    if (isQuitApproved() || hasVisibleWindowOtherThan(orchestratorWindow)) {
      return;
    }
    event.preventDefault();
    void requestQuitApproval().then((approved) => {
      if (approved && orchestratorWindow && !orchestratorWindow.isDestroyed()) {
        orchestratorWindow.close();
      }
    });
  });

  orchestratorWindow.on("closed", () => {
    orchestratorWindow = null;
    publisher.publish("window.focus-changed", null);
    // The window is already out of the list by now, so nothing to exclude.
    if (!hasVisibleWindowOtherThan(null)) {
      app.quit();
    }
  });

  orchestratorWindow.on("focus", () => {
    publisher.publish("window.focus-changed", null);
  });

  orchestratorWindow.webContents.setWindowOpenHandler((details) => {
    void openExternal(details.url);
    return { action: "deny" };
  });

  guardNavigation(orchestratorWindow.webContents);

  // A trackpad swipe or a mouse thumb button asks for history, and both reach
  // the main process rather than the page; the window's own router answers.
  orchestratorWindow.on("swipe", (_event, direction) => {
    if (direction === "left") {
      publisher.publish("orchestrator.command", "back");
    } else if (direction === "right") {
      publisher.publish("orchestrator.command", "forward");
    }
  });
  orchestratorWindow.on("app-command", (event, command) => {
    if (command === "browser-backward") {
      event.preventDefault();
      publisher.publish("orchestrator.command", "back");
    } else if (command === "browser-forward") {
      event.preventDefault();
      publisher.publish("orchestrator.command", "forward");
    }
  });

  // The Browser screen's tabs are browser guests like a task's, mounted by
  // this window's pool and driven by the same manager, so the orchestrator's
  // tasks can be handed one by target id.
  getBrowserViewManager()?.bindHost(
    orchestratorWindow.webContents,
    "orchestrator",
  );

  loadWindowURL(orchestratorWindow.webContents, studioURL("/orchestrator/"));

  createContextMenu({ browserWindow: orchestratorWindow });

  return orchestratorWindow;
}

export function updateOrchestratorWindowBackgroundColor() {
  if (orchestratorWindow && !orchestratorWindow.isDestroyed()) {
    orchestratorWindow.setBackgroundColor(getBackgroundColor());
  }
}

/**
 * Whether the user can still see a window other than this one. The classic
 * window is open under Instrument 2.0 only to hold the tasks' machinery and is
 * kept hidden, so it is not a window to be left with: `window-all-closed`
 * counts it and would never fire, leaving a running process with nothing on
 * screen and, outside macOS, no dock or tray to bring one back from.
 */
function hasVisibleWindowOtherThan(exclude: BrowserWindow | null) {
  return BrowserWindow.getAllWindows().some(
    (window) =>
      window !== exclude && !window.isDestroyed() && window.isVisible(),
  );
}
