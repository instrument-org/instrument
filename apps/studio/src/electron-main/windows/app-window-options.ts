import { getAppSession } from "@/electron-main/lib/app-session";
import { systemRegionArguments } from "@/electron-main/lib/system-country";
import { getBackgroundColor } from "@/electron-main/lib/theme-utils";
import {
  getAppZoom,
  getWindowState,
  type WindowBounds,
} from "@/electron-main/stores/workspace/window-state";
import { captionOverlay } from "@/electron-main/windows/caption-buttons";
import { isDrivenInstance } from "@/electron-main/windows/on-screen";
import { type BrowserWindowConstructorOptions } from "electron";
import path from "node:path";

/** The shape a window takes the first time, before it has been sized. */
const WINDOW_WIDTH = 1240;
const WINDOW_HEIGHT = 840;

/** Where a window opens: where it was left, or its first-time shape. */
export function rememberedStateOf(id: string) {
  return getWindowState(id, {
    height: WINDOW_HEIGHT,
    width: WINDOW_WIDTH,
  });
}

/**
 * What an app window is made with, wherever it is made: the launch's first
 * (`early-window.ts`) and every other (`app-window.ts`).
 */
export function appWindowOptions(
  id: string,
  { bounds, isSpare }: { bounds: WindowBounds; isSpare: boolean },
): BrowserWindowConstructorOptions {
  return {
    ...bounds,
    // On macOS the first click on a window behind another only brings it
    // forward unless told otherwise, and over the bar that press drags the
    // window: a tab pulled out of a window in the back would move the window.
    acceptFirstMouse: true,
    // Left to itself, Electron paints the active window's edge from Windows'
    // accent setting and can get the color wrong (default blue where the
    // system's own windows use the person's accent). Off, Windows draws its
    // usual quiet edge.
    accentColor: false,
    backgroundColor: getBackgroundColor(),
    // On macOS the native NSWindow frame is kept, since `hiddenInset` already
    // gives the chromeless look and a frameless window cannot host modal
    // sheets. Everywhere else the frame is what draws a title bar above this
    // window's own bar, so it goes and the system draws only its buttons, over
    // the ground above the card (`captionOverlay`).
    frame: process.platform === "darwin",
    minHeight: 520,
    minWidth: 900,
    show: false,
    // Not on the taskbar until it is adopted.
    skipTaskbar: isSpare,
    // A system set to prefer tabs would otherwise gather these into native
    // tabs, over the strip each window draws for itself.
    tabbingIdentifier: id,
    title: "Instrument",
    ...(process.platform === "darwin"
      ? {}
      : { titleBarOverlay: captionOverlay(getAppZoom()) }),
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    webPreferences: {
      additionalArguments: ["--windowType=app", ...systemRegionArguments()],
      // An agent's instance keeps drawing, and taking input, off screen or
      // behind other windows.
      backgroundThrottling: !isDrivenInstance(),
      contextIsolation: true,
      preload: path.join(import.meta.dirname, "../preload/index.mjs"),
      sandbox: false,
      session: getAppSession(),
      // The Browser tab is a renderer-hosted `<webview>`, like a task's browser.
      webviewTag: true,
    },
  };
}
