import { publisher } from "@/electron-main/rpc/publisher";
import {
  getAppZoom,
  keepBoundsOnScreen,
} from "@/electron-main/stores/workspace/window-state";
import {
  appWindowIdOfWindow,
  getAppWindows,
} from "@/electron-main/windows/app-window";
import { isDrivenInstance } from "@/electron-main/windows/on-screen";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { BrowserWindow, nativeTheme, screen, webContents } from "electron";

/** How wide the picture of a tab being carried is. */
const GHOST_WIDTH = 280;
/** Its height: a picture of the window, under its name. */
const GHOST_HEIGHT = 200;
/** How far it stands off the pointer, so what is under the pointer shows. */
const GHOST_OFFSET = 12;

export type TabCarryDestination =
  /** Stays where it is: let go over its own strip, canceled, or the window itself moved. */
  | { kind: "none" }
  /** A window of its own, where it was let go. */
  | { kind: "new"; point: Point }
  /** Another window's strip, at a point along it. */
  | { clientX: number; id: string; kind: "window" };

interface Point {
  x: number;
  y: number;
}

/** Whether a point is on a window at all, and on the band its strip draws in. */
export function placeOnWindow(
  bounds: { height: number; width: number; x: number; y: number },
  point: Point,
  bandHeight: number,
): "band" | "body" | "off" {
  if (
    point.x < bounds.x ||
    point.x >= bounds.x + bounds.width ||
    point.y < bounds.y ||
    point.y >= bounds.y + bounds.height
  ) {
    return "off";
  }
  return point.y - bounds.y < bandHeight ? "band" : "body";
}

/**
 * Where a tab let go at a point lands, from the windows front to back: the
 * first one under the point takes it. Over another window's strip it joins
 * that strip, and over its own it stays; anywhere else it is a window of its
 * own, the way a browser's tab is, even over another window's page.
 */
export function carryDestination<W extends WindowForCarry>({
  bandHeight,
  canceled,
  from,
  point,
  windows,
}: {
  bandHeight: number;
  canceled: boolean;
  from: W;
  point: Point | undefined;
  windows: readonly W[];
}): { place: "band" | "new" | "none"; window?: W } {
  if (canceled || !point) {
    return { place: "none" };
  }
  for (const window of windows) {
    const place = placeOnWindow(window.bounds, point, bandHeight);
    if (place === "band") {
      return window === from ? { place: "none" } : { place: "band", window };
    }
    if (place === "body") {
      break;
    }
  }
  return { place: "new" };
}

interface WindowForCarry {
  bounds: { height: number; width: number; x: number; y: number };
}

interface Carry {
  /** The picture of the tab under the pointer; none in an instance kept off screen. */
  ghost: BrowserWindow | null;
  isOnlyTab: boolean;
  /** The window whose strip is showing where the tab would land. */
  overStrip: BrowserWindow | null;
  webContentsId: number;
}

let carry: Carry | null = null;

function carriableWindows() {
  return getAppWindows()
    .filter((window) => !window.isMinimized())
    .map((window) => ({
      bounds: window.getBounds(),
      window,
    }));
}

/**
 * Starts carrying a tab out of its window: the renderer holding the drag tells
 * main where the pointer is, and main, which alone sees every window, says
 * which strip it is over and draws a picture of the tab under it, since a
 * window's drawing stops at its edge. Real positions come from the renderer's
 * pointer events, which keep arriving outside the window while the button is
 * down, and which a Wayland session cannot ask for in any other way.
 */
export function startTabCarry({
  isOnlyTab,
  title,
  webContentsId,
}: {
  isOnlyTab: boolean;
  title: string;
  webContentsId: number;
}) {
  stopCarry();
  const ghost = isDrivenInstance() ? null : openGhost(title);
  carry = { ghost, isOnlyTab, overStrip: null, webContentsId };
  if (ghost) {
    const source = webContents.fromId(webContentsId);
    void source?.capturePage().then((image) => {
      if (!ghost.isDestroyed() && !image.isEmpty()) {
        const picture = image.resize({ width: GHOST_WIDTH }).toDataURL();
        void ghost.webContents.executeJavaScript(
          `document.getElementById("picture").src = ${JSON.stringify(picture)};`,
        );
      }
    });
  }
}

export function moveTabCarry(point: Point) {
  if (!carry) {
    return;
  }
  const source = webContents.fromId(carry.webContentsId);
  const from = source ? BrowserWindow.fromWebContents(source) : null;
  if (!from) {
    return;
  }
  const windows = carriableWindows();
  const { place, window } = carryDestination({
    bandHeight: TOOLBAR_HEIGHT * getAppZoom(),
    canceled: false,
    from: windows.find((each) => each.window === from) ?? {
      bounds: from.getBounds(),
      window: from,
    },
    point,
    windows,
  });
  const over = place === "band" ? (window?.window ?? null) : null;
  if (carry.overStrip && carry.overStrip !== over) {
    previewOn(carry.overStrip, null);
  }
  carry.overStrip = over;
  if (over) {
    previewOn(over, point.x - over.getBounds().x);
  }
  const { ghost } = carry;
  if (ghost && !ghost.isDestroyed()) {
    // Back over a strip the tab's own place shows it, here or in the window
    // it is over.
    if (place === "new") {
      ghost.setPosition(
        Math.round(point.x + GHOST_OFFSET),
        Math.round(point.y + GHOST_OFFSET),
      );
      if (!ghost.isVisible()) {
        ghost.showInactive();
      }
    } else if (ghost.isVisible()) {
      ghost.hide();
    }
  }
}

function previewOn(window: BrowserWindow, clientX: null | number) {
  if (!window.isDestroyed()) {
    publisher.publish("window.tab-drop-preview", {
      clientX,
      webContentsId: window.webContents.id,
    });
  }
}

/** Lets the tab go, and says where it lands. The only tab of a window moves the window itself. */
export function endTabCarry({
  canceled,
  point,
}: {
  canceled: boolean;
  point?: Point | undefined;
}): TabCarryDestination {
  const ending = carry;
  stopCarry();
  if (!ending) {
    return { kind: "none" };
  }
  const source = webContents.fromId(ending.webContentsId);
  const from = source ? BrowserWindow.fromWebContents(source) : null;
  if (!from) {
    return { kind: "none" };
  }
  const windows = carriableWindows();
  const { place, window } = carryDestination({
    bandHeight: TOOLBAR_HEIGHT * getAppZoom(),
    canceled,
    from: windows.find((each) => each.window === from) ?? {
      bounds: from.getBounds(),
      window: from,
    },
    point,
    windows,
  });
  if (place === "band" && window && point) {
    const id = appWindowIdOfWindow(window.window);
    return id === undefined
      ? { kind: "none" }
      : {
          clientX: point.x - window.bounds.x,
          id,
          kind: "window",
        };
  }
  if (place === "new" && point) {
    if (ending.isOnlyTab) {
      const { x, y } = keepBoundsOnScreen({
        ...from.getBounds(),
        x: Math.round(point.x - GHOST_WIDTH / 2),
        y: Math.round(point.y - TOOLBAR_HEIGHT / 2),
      });
      from.setPosition(x, y);
      return { kind: "none" };
    }
    return { kind: "new", point };
  }
  return { kind: "none" };
}

function stopCarry() {
  if (!carry) {
    return;
  }
  if (carry.overStrip) {
    previewOn(carry.overStrip, null);
  }
  if (carry.ghost && !carry.ghost.isDestroyed()) {
    carry.ghost.destroy();
  }
  carry = null;
}

/**
 * A small window that never takes focus or the pointer, which is what lets
 * the release land on what is under it.
 */
function openGhost(title: string) {
  const { x, y } = screen.getCursorScreenPoint();
  const ghost = new BrowserWindow({
    alwaysOnTop: true,
    focusable: false,
    frame: false,
    hasShadow: true,
    height: GHOST_HEIGHT,
    resizable: false,
    roundedCorners: true,
    show: false,
    skipTaskbar: true,
    transparent: true,
    width: GHOST_WIDTH,
    x: x + GHOST_OFFSET,
    y: y + GHOST_OFFSET,
  });
  ghost.setIgnoreMouseEvents(true);
  void ghost.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(ghostPage(title))}`,
  );
  return ghost;
}

function ghostPage(title: string) {
  const isDark = nativeTheme.shouldUseDarkColors;
  const escaped = title
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<!doctype html><html><body style="margin:0;height:100vh;overflow:hidden;border-radius:10px;background:${
    isDark ? "#27272a" : "#ffffff"
  };color:${
    isDark ? "#fafafa" : "#18181b"
  };font:500 13px -apple-system,system-ui,sans-serif"><div style="padding:8px 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escaped}</div><img id="picture" alt="" style="display:block;width:100%" /></body></html>`;
}
