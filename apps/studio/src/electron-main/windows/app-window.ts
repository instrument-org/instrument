import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { getAppSession } from "@/electron-main/lib/app-session";
import { createContextMenu } from "@/electron-main/lib/context-menu";
import { guardNavigation } from "@/electron-main/lib/guard-navigation";
import { loadWindowURL } from "@/electron-main/lib/load-window-url";
import { openExternal } from "@/electron-main/lib/open-external";
import {
  isQuitApproved,
  quitsWithLastWindow,
  requestQuitApproval,
} from "@/electron-main/lib/quit";
import { getBackgroundColor } from "@/electron-main/lib/theme-utils";
import { systemRegionArguments } from "@/electron-main/lib/system-country";
import { isSetupUp, readSetupState } from "@/electron-main/lib/setup-state";
import { studioURL } from "@/electron-main/lib/urls";
import { bindAppWindowChords } from "@/electron-main/menus/app-window";
import { bindShortcutAccelerators } from "@/electron-main/menus/shortcuts";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  FIRST_APP_WINDOW_ID,
  forgetWindowKeptState,
  getWindowKeptState,
  setWindowKeptState,
  tellWindowKeptState,
  windowKeptKeys,
} from "@/electron-main/stores/workspace/kept-state";
import {
  APP_TABS_KEY,
  COMPOSE_KEY,
  isHostedPageKey,
  WINDOW_KEPT_KEYS,
} from "@/shared/kept-state";
import { type Tab, type TabsModel, TabsModelSchema } from "@/shared/tabs";
import {
  getAppZoom,
  getWindowState,
  hasWindowState,
  keepBoundsOnScreen,
  forgetWindow,
  rememberedWindowIds,
  rememberWindowClosed,
  rememberWindowInFront,
  setWindowState,
} from "@/electron-main/stores/workspace/window-state";
import {
  expectRestoredWindows,
  isComingBackAsLeft,
  isDrivenInstance,
  isHeldOffScreen,
  keepsOffScreen,
  putOnScreen,
  showHeldWindows,
} from "@/electron-main/windows/on-screen";
import {
  type AppWindowAsk,
  createAppWindowAsks,
} from "@/electron-main/windows/app-window-asks";
import {
  forgetAppWindowName,
  nameAppWindow,
} from "@/electron-main/windows/app-window-ids";
import {
  opensSetupSized,
  forgetSetupWindowPlace,
  grownFromSetup,
  keepSetupWindowPlace,
  setupBounds,
} from "@/electron-main/windows/setup-size";
import { showWhenReady } from "@/electron-main/windows/show-when-ready";
import { setTrafficLightForZoom } from "@/electron-main/windows/traffic-lights";
import { commandWindow } from "@/electron-main/windows/window-command";
import { trackWindowBounds } from "@/electron-main/windows/window-bounds";
import { folderHref } from "@/shared/computer-href";
import { is } from "@electron-toolkit/utils";
import {
  type BrowserTargetId,
  browserTargetOf,
} from "@instrument-org/workspace/electron";
import { app, BrowserWindow, powerMonitor } from "electron";
import { statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

import { mergeFloats } from "./tab-carry-rules";

/** The shape a window takes the first time, before it has been sized. */
const WINDOW_WIDTH = 1240;
const WINDOW_HEIGHT = 840;

/** How far a new window stands off the one in front of it, so both show. */
const CASCADE_PX = 26;

/** Each open window, by the id it keeps its state under. */
const openWindows = new Map<string, BrowserWindow>();

/** The open windows, the one last in front first. */
let inFront: BrowserWindow[] = [];

/**
 * The window at setup's own shape, fixed, which is never saved as where the
 * window was left. Set as it opens, and cleared once setup is done.
 */
let setupSized: BrowserWindow | null = null;

/**
 * Whether boot has opened a window yet. It opens the first once setup's
 * facts are known, so an ask that arrives before then waits for that one
 * rather than opening a window of its own.
 */
let hasOpened = false;

/** The windows whose every tab went to another window, which leave nothing to come back to. */
const emptied = new Set<BrowserWindow>();

/**
 * A window kept booted and out of sight, on none of the lists above, for a tab's
 * drag to put the tabs it leaves behind in, or the tab itself. It is an ordinary
 * app window, which stands on a tab of its own until it is given others, as a
 * window coming back from a launch does.
 */
export interface SpareWindow {
  id: string;
  /** Its page can hear what it is given. */
  isUp: boolean;
  /** Kept apart from `window`, whose contents can no longer be read once it is destroyed. */
  webContentsId: number;
  window: BrowserWindow;
}

/** Every spare window not yet adopted: the one waiting, and any a drag has taken. */
const spares = new Set<SpareWindow>();
let waitingSpare: SpareWindow | null = null;
let spareTimer: NodeJS.Timeout | undefined;
/** How long after a window opens, or the last spare goes, the next one starts. */
const SPARE_DELAY_MS = 4000;

/** The windows a launch brings back once setup is out of the way. */
let waitingForSetup: string[] = [];

/** The windows whose page has asked for what waited for it, and so hear the command stream. */
const listening = new Set<number>();

/**
 * Asks from outside, in order: several files handed over at once arrive one
 * by one while the window is still opening. The window's command stream
 * starts empty at subscribe time, so a command published while the renderer
 * is still loading is lost; the layout asks for these once it is up instead.
 * While setup is up they wait for it, and go to the window when it is done.
 */
const asks = createAppWindowAsks({
  deliver: (ask) => {
    const window =
      inFront.find((each) => listening.has(each.webContents.id)) ?? null;
    if (window) {
      commandWindow(window, ask);
    }
  },
  isHeld: isSetupUp,
});

/** A window's page stopped hearing the command stream; asks wait once none is. */
function stopListening(webContentsId: number) {
  const spare = spareOf(webContentsId);
  if (spare) {
    spare.isUp = false;
  }
  listening.delete(webContentsId);
  if (listening.size === 0) {
    asks.stopTaking();
  }
}

/** The window last in front, which is what the app means by "the window". */
export function getAppWindow(): BrowserWindow | null {
  return inFront.find((window) => !window.isDestroyed()) ?? null;
}

/** Every open app window, the one last in front first. */
export function getAppWindows(): BrowserWindow[] {
  return inFront.filter((window) => !window.isDestroyed());
}

export function isAppWindow(window: BrowserWindow) {
  return inFront.includes(window);
}

/** Whether this web contents is the one app window there is. */
export function isOnlyAppWindow(webContentsId: number) {
  const windows = getAppWindows();
  return windows.length === 1 && windows[0]?.webContents.id === webContentsId;
}

export function appWindowIdOfWindow(window: BrowserWindow) {
  for (const [id, each] of openWindows) {
    if (each === window) {
      return id;
    }
  }
  return undefined;
}

/** The other windows, front to back, by what each is called now. */
export function otherAppWindows(webContentsId: number) {
  return getAppWindows()
    .filter((window) => window.webContents.id !== webContentsId)
    .flatMap((window) => {
      const id = appWindowIdOfWindow(window);
      return id === undefined ? [] : [{ id, title: window.getTitle() }];
    });
}

/** A window's tabs, as it keeps them. */
export function keptTabsOf(id: string): TabsModel {
  const parsed = TabsModelSchema.safeParse(
    getWindowKeptState(id, APP_TABS_KEY),
  );
  return parsed.success
    ? parsed.data
    : { recentlyClosed: [], selectedId: null, tabs: [] };
}

const HostedPageGroupSchema = z.object({
  tabs: z.array(z.object({ id: z.string() })),
});

/** The pages drawn inside a window's surfaces, which no other window's tabs name and which go when it does. */
export function hostedPagesOf(id: string): BrowserTargetId[] {
  return windowKeptKeys(id)
    .filter(isHostedPageKey)
    .flatMap(
      (key) =>
        HostedPageGroupSchema.safeParse(
          getWindowKeptState(id, key),
        ).data?.tabs.map((tab) => browserTargetOf(tab.id)) ?? [],
    );
}

/**
 * The window that has a screen in a tab, by its address: the one with that
 * tab up if there is one, else the one in front of the others with it behind.
 */
export function appWindowShowing(
  href: string,
  among: readonly BrowserWindow[] = getAppWindows(),
): BrowserWindow | null {
  const standsThere = (pathname: string) =>
    pathname === href || pathname.startsWith(`${href}?`);
  let behind: BrowserWindow | null = null;
  for (const window of among) {
    const id = appWindowIdOfWindow(window);
    if (id !== undefined) {
      const { selectedId, tabs } = keptTabsOf(id);
      const tab = tabs.find(
        (each) => each.id === selectedId && standsThere(each.pathname),
      );
      if (tab) {
        return window;
      }
      if (!behind && tabs.some((each) => standsThere(each.pathname))) {
        behind = window;
      }
    }
  }
  return behind;
}

/**
 * Which window answers what a chat asks of its tabs and mounts the guests it
 * makes: of the windows whose page can hear it, the one showing the chat, else
 * the one in front. Named once for each ask, so one opens one page, and named
 * with none hearing, or a spare, which hears everything named to no one, would
 * host it out of sight.
 */
export function appWindowForChat(chatId: string | undefined) {
  const hearing = getAppWindows().filter((window) =>
    listening.has(window.webContents.id),
  );
  const window =
    (chatId === undefined
      ? null
      : appWindowShowing(`/chats/${chatId}`, hearing)) ??
    hearing[0] ??
    getAppWindow();
  return window?.webContents.id;
}

/**
 * Opens a file handed to the app from outside it, a double click, Open With,
 * or a drop on the Dock icon, in the window in front or the one this opens. A
 * folder opens in the folder view, standing in it.
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
 * Puts a screen of the window up, by its route: in the window that has it, in
 * the one in front, or in the one this opens. What a link from outside the app
 * asks for.
 */
export function openAppScreen(href: string) {
  if (!showInWindowHolding(href)) {
    askAppWindow({ href, type: "openScreen" });
  }
}

/**
 * Brings forward the window that already has a screen in a tab, with that tab
 * up. False where no window has it.
 */
export function showInWindowHolding(href: string) {
  const showing = appWindowShowing(href);
  if (!showing) {
    return false;
  }
  // Held after a restart, the person who followed a link has to be shown it.
  if (isHeldOffScreen(showing) && !keepsOffScreen()) {
    showHeldWindows();
  }
  if (!isHeldOffScreen(showing)) {
    if (showing.isMinimized()) {
      showing.restore();
    }
    showing.focus();
  }
  askWindow(showing, { href, type: "openScreen" });
  return true;
}

/**
 * The window last in front, or, with none open, the one last closed brought
 * back as it was. A launch brings back every window (`restoreAppWindows`).
 */
export function openAppWindow(): BrowserWindow {
  const front = getAppWindow();
  if (front) {
    if (!isHeldOffScreen(front)) {
      front.focus();
    }
    return front;
  }
  const { closed, open } = rememberedWindowIds(FIRST_APP_WINDOW_ID);
  return createAppWindow(closed[0] ?? open.at(-1) ?? FIRST_APP_WINDOW_ID);
}

/**
 * Every window the workspace was left with, each where it was with its tabs,
 * the one last in front on top; or the one closed last where all of them were
 * closed. While setup is up only that one opens, since setup draws over it,
 * and the rest come back as it goes down.
 */
export function restoreAppWindows() {
  const { closed, open } = rememberedWindowIds(FIRST_APP_WINDOW_ID);
  const ids = open.length > 0 ? open : [closed[0] ?? FIRST_APP_WINDOW_ID];
  if (isSetupUp()) {
    const front = ids.at(-1) ?? FIRST_APP_WINDOW_ID;
    waitingForSetup = ids.filter((id) => id !== front);
    createAppWindow(front);
    return;
  }
  // A restart to install an update brings them back as they were, behind
  // whatever the person is doing.
  const takesFocus = !isComingBackAsLeft();
  expectRestoredWindows(ids.length);
  const windows = ids.map((id) => createAppWindow(id));
  // Each comes up as its page is ready, in no particular order, so the one
  // that was in front goes back there once they all have.
  const front = windows.at(-1);
  if (front && windows.length > 1) {
    comingToFront = front;
    let waiting = windows.length;
    const onUp = () => {
      waiting -= 1;
      if (waiting > 0) {
        return;
      }
      comingToFront = null;
      if (takesFocus && !front.isDestroyed() && !isHeldOffScreen(front)) {
        front.moveTop();
        if (!is.dev) {
          front.focus();
        }
      }
    };
    for (const window of windows) {
      // A link during boot can have opened one already, and it will not say so again.
      if (window.isVisible()) {
        onUp();
      } else {
        window.once("ready-to-show", onUp);
      }
    }
  }
}

/** A window of its own, at the inbox, standing off the one in front. */
export function openNewAppWindow(tab?: Tab): BrowserWindow | null {
  if (isSetupUp()) {
    return null;
  }
  const id = newWindowId();
  if (tab) {
    setWindowKeptState(id, APP_TABS_KEY, {
      recentlyClosed: [],
      selectedId: tab.id,
      tabs: [tab],
    });
  }
  return createAppWindow(id, { bounds: cascadedBounds() });
}

function openSpareWindow(): SpareWindow {
  const id = newWindowId();
  const window = createAppWindow(id, { isSpare: true });
  // Out of the Window menu and the Dock's list of windows while it is shown
  // for a drag, as nobody's window yet.
  window.excludedFromShownWindowsMenu = true;
  const opened = {
    id,
    isUp: false,
    webContentsId: window.webContents.id,
    window,
  };
  spares.add(opened);
  return opened;
}

function spareOf(webContentsId: number) {
  return [...spares].find((spare) => spare.webContentsId === webContentsId);
}

/**
 * Starts the waiting spare again. A window kept out of sight for hours is the
 * one likeliest to come back blank after the computer sleeps or the GPU
 * process goes, and a drag finding it so would put a blank window up.
 */
function renewSpare() {
  // Closing it starts another (the window's `closed`).
  if (waitingSpare && !waitingSpare.window.isDestroyed()) {
    waitingSpare.window.destroy();
  }
}

let watchingForStaleSpares = false;

function watchForStaleSpares() {
  if (watchingForStaleSpares) {
    return;
  }
  watchingForStaleSpares = true;
  powerMonitor.on("resume", renewSpare);
  app.on("child-process-gone", (_event, details) => {
    if (details.type === "GPU") {
      renewSpare();
    }
  });
}

/** Starts a spare window before long, if there is not one. */
function keepSpareReady() {
  // An agent's instance keeps to the windows it is driving; a drag opens one.
  if (isDrivenInstance()) {
    return;
  }
  watchForStaleSpares();
  clearTimeout(spareTimer);
  spareTimer = setTimeout(() => {
    if (!waitingSpare && !isSetupUp() && getAppWindows().length > 0) {
      waitingSpare = openSpareWindow();
    }
  }, SPARE_DELAY_MS);
}

/**
 * The spare window, for a drag to use. Where none has finished starting one opens
 * now, which reads what the drag writes for it as it loads.
 */
export function takeSpareWindow(): SpareWindow | null {
  if (isSetupUp()) {
    return null;
  }
  if (!waitingSpare?.isUp) {
    return openSpareWindow();
  }
  const taken = waitingSpare;
  waitingSpare = null;
  taken.window.setBackgroundColor(getBackgroundColor());
  setTrafficLightForZoom(taken.window, getAppZoom());
  return taken;
}

/**
 * A spare window a drag has no more use for, out of sight and on a tab of its own
 * again, unless another is waiting.
 */
export function returnSpareWindow(taken: SpareWindow) {
  if (taken.window.isDestroyed()) {
    return;
  }
  if (waitingSpare) {
    taken.window.destroy();
    keepSpareReady();
    return;
  }
  taken.window.setIgnoreMouseEvents(false);
  taken.window.hide();
  for (const key of windowKeptKeys(taken.id)) {
    tellWindowKeptState(taken.id, taken.window.webContents, key, undefined);
  }
  waitingSpare = taken;
}

/** A spare window that now holds tabs of the person's: a window like any other from here. */
export function adoptSpareWindow(adopted: SpareWindow) {
  const { id, isUp, window } = adopted;
  window.setIgnoreMouseEvents(false);
  window.setSkipTaskbar(false);
  window.excludedFromShownWindowsMenu = false;
  spares.delete(adopted);
  if (isUp) {
    listening.add(window.webContents.id);
  } else {
    adoptedBeforeUp.set(window.webContents.id, adopted);
  }
  openWindows.set(id, window);
  inFront = inFront.toSpliced(1, 0, window);
  // Under the window in front, as it stands: remembered in the order they are in.
  for (const each of inFront.toReversed()) {
    const eachId = appWindowIdOfWindow(each);
    if (eachId !== undefined) {
      rememberWindowInFront(eachId);
    }
  }
  setWindowState(id, {
    bounds: window.getBounds(),
    isMaximized: window.isMaximized(),
  });
  publisher.publish("windows.changed", null);
  // Its pages can come to it now.
  publisher.publish("browser.targets-changed", null);
  // An instance kept off screen holds it there, as it does any window of its own.
  if (keepsOffScreen()) {
    putOnScreen(window, { maximized: false });
  }
  keepSpareReady();
}

/** Closes a window all of whose tabs went elsewhere. */
export function closeEmptiedWindow(window: BrowserWindow) {
  emptied.add(window);
  window.close();
}

/** A spare a tab was let go in before its page was up, by its page, until the page says it is. */
const adoptedBeforeUp = new Map<number, SpareWindow>();

/** Whether a closed window can come back. */
export function canReopenClosedAppWindow() {
  return rememberedWindowIds(FIRST_APP_WINDOW_ID).closed.some(
    (id) => !openWindows.has(id),
  );
}

/** The window closed last, as it was. False when none can come back. */
export function reopenClosedAppWindow() {
  const id = rememberedWindowIds(FIRST_APP_WINDOW_ID).closed.find(
    (closed) => !openWindows.has(closed),
  );
  if (id === undefined || isSetupUp()) {
    return false;
  }
  createAppWindow(id);
  return true;
}

/** Whether there is more than one window to merge. */
export function canMergeWindows() {
  return getAppWindows().length > 1;
}

/**
 * Every other window's tabs, pages and floats into the one in front, and those
 * windows gone with nothing to come back to. Only one window can stay itself, so
 * the tabs open afresh there, each from its address and history.
 */
export function mergeAllWindows() {
  const [front, ...others] = getAppWindows();
  const to = front && appWindowIdOfWindow(front);
  if (!front || to === undefined || !listening.has(front.webContents.id)) {
    return;
  }
  const manager = getBrowserViewManager();
  const kept = keptTabsOf(to);
  const tabs = [...kept.tabs];
  const recentlyClosed = [...kept.recentlyClosed];
  let floats = getWindowKeptState(to, COMPOSE_KEY);
  for (const other of others) {
    const from = appWindowIdOfWindow(other);
    if (from !== undefined) {
      const model = keptTabsOf(from);
      tabs.push(...model.tabs);
      recentlyClosed.push(...model.recentlyClosed);
      floats = mergeFloats(floats, getWindowKeptState(from, COMPOSE_KEY));
      manager.handOffGuestsOf(
        other.webContents.id,
        front.webContents.id,
        hostedPagesOf(from),
      );
    }
  }
  tellWindowKeptState(to, front.webContents, APP_TABS_KEY, {
    ...kept,
    recentlyClosed,
    tabs,
  });
  tellWindowKeptState(to, front.webContents, COMPOSE_KEY, floats);
  for (const other of others) {
    closeEmptiedWindow(other);
  }
  if (!isHeldOffScreen(front)) {
    if (front.isMinimized()) {
      front.restore();
    }
    front.focus();
  }
}

/**
 * Hands a tab, history and all, to a window that is open, which puts it at a
 * place along its strip. Says whether it could: a page not listening yet could
 * not take it, and the tab would be lost.
 */
export function sendTabToWindow(tab: Tab, id: string, index?: number) {
  const target = openWindows.get(id);
  if (
    !target ||
    target.isDestroyed() ||
    !listening.has(target.webContents.id)
  ) {
    return false;
  }
  commandWindow(target, {
    ...(index === undefined ? {} : { index }),
    tab,
    type: "receiveTab",
  });
  return true;
}

/** An open window by the id a tab's menu names it by. */
export function appWindowById(id: string) {
  return openWindows.get(id);
}

function newWindowId() {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** The size of the window in front and a step off it, or a first window's. */
export function cascadedBounds() {
  const front = getAppWindow();
  if (!front) {
    return rememberedStateOf(FIRST_APP_WINDOW_ID).bounds;
  }
  const bounds = front.getNormalBounds();
  return keepBoundsOnScreen({
    ...bounds,
    x: bounds.x + CASCADE_PX,
    y: bounds.y + CASCADE_PX,
  });
}

/**
 * An app window: the inbox of chats, the tasks they started, and the tabs the
 * user and the agents open. Its renderer hosts the browser guests of the pages
 * it shows. `id` is what it keeps its state under, which a window brought back
 * finds as it was left.
 */
function createAppWindow(
  id: string,
  {
    bounds,
    isSpare = false,
  }: { bounds?: ReturnType<typeof cascadedBounds>; isSpare?: boolean } = {},
): BrowserWindow {
  // A second launch or a link can open it while boot is on its way to doing so.
  const open = openWindows.get(id);
  if (open && !open.isDestroyed()) {
    inFront = [open, ...inFront.filter((each) => each !== open)];
    rememberWindowInFront(id);
    return open;
  }
  hasOpened = true;
  watchSetup();
  const remembered = rememberedStateOf(id);
  // Someone new meets setup in a window its own size; someone shown one new
  // step after an update keeps the window as they left it.
  const isSetupSized =
    openWindows.size === 0 && opensSetupSized(readSetupState());
  const opening = bounds ?? remembered.bounds;

  const window = new BrowserWindow({
    ...(isSetupSized ? setupBounds() : opening),
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
    // window's own bar, so it goes and the renderer draws the window controls
    // (see WindowControls).
    frame: process.platform === "darwin",
    fullscreenable: !isSetupSized,
    maximizable: !isSetupSized,
    minHeight: 520,
    minWidth: 900,
    resizable: !isSetupSized,
    show: false,
    // Not on the taskbar until it is adopted.
    skipTaskbar: isSpare,
    // A system set to prefer tabs would otherwise gather these into native
    // tabs, over the strip each window draws for itself.
    tabbingIdentifier: id,
    title: "Instrument",
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
  });
  if (isSetupSized) {
    setupSized = window;
  }

  const webContentsId = window.webContents.id;
  // Named before it loads: its preload asks for what it kept as it does.
  nameAppWindow(webContentsId, id);
  if (!isSpare) {
    openWindows.set(id, window);
    inFront = [window, ...inFront];
    rememberWindowInFront(id);
    publisher.publish("windows.changed", null);
    keepSpareReady();
  }

  const tracked = trackWindowBounds(window, id, {
    isHeld: () => setupSized === window || spareOf(webContentsId) !== undefined,
  });
  // Setup's window comes back where it was after a restart setup makes,
  // which is a quit like any other.
  const keepSetupPlace = () => {
    if (setupSized === window && !window.isDestroyed()) {
      keepSetupWindowPlace(window.getBounds());
    }
  };
  app.on("before-quit", keepSetupPlace);
  window.on("closed", () => {
    app.off("before-quit", keepSetupPlace);
  });
  // Every way this window changes shape. `will-resize` and `move` are here
  // because macOS does not report a resize the user did not drive (a tiling
  // manager) and Linux does not reliably report maximize on its own.
  const sized = () => {
    tracked.saveSoon();
  };
  window.on("will-resize", sized);
  window.on("resize", sized);
  window.on("move", sized);
  // Also told to the renderer, which draws this window's own maximize and
  // restore glyph and, on an X11 session, the hairline that has to go when an
  // edge sits against the screen. The OS drives these as well as the buttons
  // do: a snap, a double click on the bar, Win+Up.
  const changedShape = () => {
    sized();
    publisher.publish("window.state-changed", null);
  };
  window.on("maximize", changedShape);
  window.on("unmaximize", changedShape);
  window.on("enter-full-screen", changedShape);
  window.on("leave-full-screen", changedShape);

  // Center the lights in the window bar for the zoom the renderer last
  // reported, so they are in place for the first paint instead of jumping once
  // this window mounts and syncs its own. Set here rather than through the
  // `trafficLightPosition` option, which only applies to frameless windows; this
  // one keeps its macOS frame.
  setTrafficLightForZoom(window, getAppZoom());

  if (!isSpare) {
    showWhenReady(window, () => {
      if (!window.isDestroyed()) {
        putOnScreen(window, {
          maximized: !isSetupSized && !bounds && remembered.isMaximized,
        });
      }
    });
  }

  // Where closing the last window the user can see quits the app, the
  // running-work warning has to happen here, while the window still exists.
  // Asking after the fact would destroy the window first and leave a canceled
  // quit with a running process the user can't get back to.
  window.on("close", (event) => {
    if (
      !quitsWithLastWindow ||
      isQuitApproved() ||
      hasVisibleWindowOtherThan(window)
    ) {
      return;
    }
    event.preventDefault();
    void requestQuitApproval().then((approved) => {
      if (approved && !window.isDestroyed()) {
        window.close();
      }
    });
  });

  // A page loading afresh is not listening yet; what is asked meanwhile waits
  // for it to ask again.
  window.webContents.on(
    "did-start-navigation",
    ({ isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) {
        stopListening(webContentsId);
      }
    },
  );
  window.webContents.on("render-process-gone", () => {
    stopListening(webContentsId);
    if (spareOf(webContentsId) && !window.isDestroyed()) {
      window.destroy();
    }
  });

  window.on("closed", () => {
    const closedSpare = spareOf(webContentsId);
    if (closedSpare) {
      spares.delete(closedSpare);
    }
    if (waitingSpare?.window === window) {
      waitingSpare = null;
      keepSpareReady();
    }
    openWindows.delete(id);
    inFront = inFront.filter((each) => each !== window);
    if (comingToFront === window) {
      comingToFront = null;
    }
    forgetAppWindowName(webContentsId);
    if (setupSized === window) {
      setupSized = null;
    }
    stopListening(webContentsId);
    // A quit closes windows too, and those are what the next launch brings
    // back. A window the person closed can come back on request instead.
    // A spare has nothing of anyone's to come back to.
    if (emptied.delete(window) || closedSpare) {
      forgetWindow(id);
      forgetWindowKeptState(id);
    } else if (!isQuitApproved()) {
      for (const gone of rememberWindowClosed(id)) {
        forgetWindowKeptState(gone);
      }
    }
    publisher.publish("windows.changed", null);
    publisher.publish("window.focus-changed", { webContentsId: null });
    // With every window gone nothing can be dragged, and a window the next one
    // opens starts another.
    if (getAppWindows().length === 0) {
      for (const each of spares) {
        each.window.destroy();
      }
    }
    // The window is already out of the list by now, so nothing to exclude.
    if (quitsWithLastWindow && !hasVisibleWindowOtherThan(null)) {
      app.quit();
    }
  });

  window.on("focus", () => {
    if (spareOf(webContentsId)) {
      return;
    }
    inFront = [window, ...inFront.filter((each) => each !== window)];
    rememberWindowInFront(id);
    publisher.publish("window.focus-changed", { webContentsId });
  });

  // What the Window menu and a tab's menu call it.
  window.on("page-title-updated", () => {
    publisher.publish("windows.changed", null);
  });

  window.webContents.setWindowOpenHandler((details) => {
    void openExternal(details.url);
    return { action: "deny" };
  });

  guardNavigation(window.webContents);
  bindAppWindowChords(window.webContents);
  // The Developer menu's chords, which would otherwise reach this window only
  // when the page leaves the key unhandled.
  bindShortcutAccelerators(window.webContents, {
    group: "Developer",
  });

  // A trackpad swipe, a keyboard's back and forward keys, and on Linux a mouse
  // thumb button ask for history here rather than in the page; the window's
  // own router answers. A thumb button on a Mac or Windows reaches only the
  // page, which answers it itself.
  window.on("swipe", (_event, direction) => {
    if (direction === "left") {
      commandWindow(window, "back");
    } else if (direction === "right") {
      commandWindow(window, "forward");
    }
  });
  window.on("app-command", (event, command) => {
    if (command === "browser-backward") {
      event.preventDefault();
      commandWindow(window, "back");
    } else if (command === "browser-forward") {
      event.preventDefault();
      commandWindow(window, "forward");
    }
  });

  // The guests of the pages this window shows are mounted by its pool and
  // driven by the manager, so a task can be handed a tab by target id.
  getBrowserViewManager().bindHost(window.webContents, {
    isSpare: () => !openWindows.has(id),
  });

  loadWindowURL(window.webContents, studioURL("/chats/"));

  createContextMenu({
    browserWindow: window,
    onOpenLink: (options) => {
      publisher.publish("window.open-menu-link", {
        ...options,
        webContentsId,
      });
    },
  });

  return window;
}

/** Where a window opens: where it was left, or its first-time shape. */
function rememberedStateOf(id: string) {
  return getWindowState(id, {
    height: WINDOW_HEIGHT,
    width: WINDOW_WIDTH,
  });
}

/** What waits for a window without taking it yet. */
export function waitingAppWindowAsks(): readonly AppWindowAsk[] {
  return asks.waiting;
}

/**
 * What was asked of the windows while one was opening, once, then nothing.
 * Nothing while setup is up: what waits goes to the window when it is done.
 */
export function takePendingAppWindowAsks(
  webContentsId: number,
): AppWindowAsk[] {
  const spare = spareOf(webContentsId);
  const started = spare ?? adoptedBeforeUp.get(webContentsId);
  if (started) {
    started.isUp = true;
    // What a drag told it while its page was starting, or took back, may have
    // gone unheard: it read its state as it loaded and listens only now.
    for (const key of new Set([
      ...WINDOW_KEPT_KEYS,
      ...windowKeptKeys(started.id),
    ])) {
      tellWindowKeptState(
        started.id,
        started.window.webContents,
        key,
        getWindowKeptState(started.id, key),
      );
    }
  }
  // A spare window's page is up and quiet, which is all this tells: nothing
  // asked of the windows is for it.
  if (spare) {
    return [];
  }
  adoptedBeforeUp.delete(webContentsId);
  listening.add(webContentsId);
  // What waited is for the window in front, which a launch restoring several
  // brings up last or first as their pages happen to load.
  const front = comingToFront ?? getAppWindow();
  return front &&
    front.webContents.id !== webContentsId &&
    !listening.has(front.webContents.id)
    ? []
    : asks.take();
}

/**
 * The window a launch restoring several puts in front once they are all up. Until
 * then each that shows takes the focus, so the one last in front is no guide.
 */
let comingToFront: BrowserWindow | null = null;

let hasSweptLaunch = false;

/**
 * Whether this window is the one to clear what a launch left over, which only
 * the first window up can tell from what another window is using right now.
 */
export function takeLaunchSweep(webContentsId: number) {
  if (hasSweptLaunch || spareOf(webContentsId)) {
    return false;
  }
  hasSweptLaunch = true;
  return true;
}

let isWatchingSetup = false;

/**
 * Follows setup going down: the window takes the remembered shape back, the
 * windows it held back come up, and the window gets what was asked of it
 * meanwhile.
 */
function watchSetup() {
  if (isWatchingSetup) {
    return;
  }
  isWatchingSetup = true;
  void publisher.subscribe("setup.updated", () => {
    if (isSetupUp()) {
      return;
    }
    leaveSetupSize();
    const waiting = waitingForSetup;
    waitingForSetup = [];
    for (const id of waiting) {
      createAppWindow(id);
    }
    asks.release();
    keepSpareReady();
  });
}

/** Back to the window's remembered bounds, resizable again, at once. */
function leaveSetupSize() {
  const window = setupSized;
  if (!window || window.isDestroyed()) {
    return;
  }
  setupSized = null;
  const id = appWindowIdOfWindow(window) ?? FIRST_APP_WINDOW_ID;
  forgetSetupWindowPlace();
  window.setResizable(true);
  window.setMaximizable(true);
  window.setFullScreenable(true);
  // A window never sized before grows where setup was, rather than jumping
  // to the middle of the main display.
  const { bounds, isMaximized } = hasWindowState(id)
    ? rememberedStateOf(id)
    : {
        bounds: grownFromSetup(window.getBounds(), {
          height: WINDOW_HEIGHT,
          width: WINDOW_WIDTH,
        }),
        isMaximized: false,
      };
  window.setBounds(bounds);
  if (isMaximized) {
    window.maximize();
  }
  // The window's own maximize control comes back with it.
  publisher.publish("window.state-changed", null);
}

export function updateAppWindowBackgroundColor() {
  for (const window of getAppWindows()) {
    window.setBackgroundColor(getBackgroundColor());
  }
}

/**
 * Puts up what something outside the window asked for, in the window in front
 * or the one this opens, once it can show it.
 */
export function askAppWindow(ask: AppWindowAsk) {
  const window = getAppWindow();
  if (window) {
    if (!isHeldOffScreen(window)) {
      window.focus();
    }
    asks.ask(ask);
    return;
  }
  asks.ask(ask);
  // An ask that launched the app arrives before boot has made a window, and
  // a link's can arrive after ready, while boot still waits on setup; boot
  // opens this one itself, and the ask waits for it.
  if (hasOpened) {
    openAppWindow();
  }
}

/** Puts up what was asked in one window, or in the one in front while that one's page cannot hear it. */
export function askWindow(window: BrowserWindow, ask: AppWindowAsk) {
  if (listening.has(window.webContents.id) && !isSetupUp()) {
    commandWindow(window, ask);
    return;
  }
  asks.ask(ask);
}

/**
 * Whether the user can still see a window other than this one. A hidden window
 * (an offscreen one drawing a file's picture) is not a window to be left with:
 * `window-all-closed` counts it and would not fire, leaving a running process
 * with nothing on screen and, outside macOS, no dock or tray to bring one back
 * from. A minimized one is: the taskbar brings it back, and on Windows it does
 * not count as visible.
 */
function hasVisibleWindowOtherThan(exclude: BrowserWindow | null) {
  return BrowserWindow.getAllWindows().some(
    (window) =>
      window !== exclude &&
      !window.isDestroyed() &&
      (window.isVisible() || window.isMinimized()) &&
      !spareOf(window.webContents.id),
  );
}
