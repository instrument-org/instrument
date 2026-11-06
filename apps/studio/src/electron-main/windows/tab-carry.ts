import {
  effectiveDisplayProtocol,
  resolveOzonePlatform,
} from "@/electron-main/lib/ozone-platform";
import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  getWindowKeptState,
  tellWindowKeptState,
  windowKeptKeys,
} from "@/electron-main/stores/workspace/kept-state";
import { getAppZoom } from "@/electron-main/stores/workspace/window-state";
import {
  adoptSpareWindow,
  appWindowById,
  appWindowIdOfWindow,
  cascadedBounds,
  closeEmptiedWindow,
  getAppWindows,
  keptTabsOf,
  returnSpareWindow,
  sendTabToWindow,
  type SpareWindow,
  takeSpareWindow,
} from "@/electron-main/windows/app-window";
import { keepsOffScreen } from "@/electron-main/windows/on-screen";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import {
  APP_TABS_KEY,
  COMPOSE_KEY,
  isHostedPageKey,
} from "@/shared/kept-state";
import {
  neighborAt,
  type Tab,
  type TabCarryView,
  type TabMoveDestination,
  type TabsModel,
  type TabStanding,
} from "@/shared/tabs";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import { app, BrowserWindow, screen, webContents } from "electron";

import {
  type Bounds,
  boundsAtRelease,
  boundsUnderPointer,
  type CarryPhase,
  isSamePhase,
  landsBy,
  mergeFloats,
  phaseAt,
  placeOnWindow,
  type Point,
  whatGoes,
} from "./tab-carry-rules";
import { openTabPicture, type TabPicture } from "./tab-picture";

/** How often main reads the cursor while a tab is carried: what follows it does so at the display's pace. */
const FOLLOW_MS = 8;
/** How long a window waits for a tab that came to it to draw, before going ahead anyway. */
const DRAWN_LIMIT_MS = 400;
/**
 * A window wholly covered by an opaque one counts as out of sight on macOS and
 * stops drawing, and the window under the spare has to draw itself as it will
 * stand before it comes out from under it.
 */
const SEE_THROUGH_OPACITY = 0.996;
/**
 * How far past another window's strip a tab held in it stays there, so that a
 * tab does not come straight back out for a pointer that barely moved.
 */
const DOCKED_REACH_PX = 24;

/**
 * Sets how see-through a window is, where that means anything. Linux does not stop
 * drawing a covered window, and a window there once given an opacity stays a few
 * percent see-through, even set back to 1.
 */
function setOpacity(window: BrowserWindow, opacity: number) {
  if (process.platform !== "linux" && !window.isDestroyed()) {
    window.setOpacity(opacity);
  }
}

/** Whether a window can be on screen and drawing with nobody seeing it. */
function canKeepWindowsUnseen() {
  return process.platform !== "linux";
}

/** What the window that held the press does as the tab is let go. */
export type TabCarryEnd =
  /** It keeps what it has: over its own strip, canceled, or it was the tab's only window. */
  | { kind: "none" }
  /** It keeps the tab alone, as main tells it: the others are in the window left behind. */
  | { kind: "keepsTab" }
  /** It keeps the tab and takes on the tabs of the window it landed on, as main tells it. */
  | { kind: "takesStrip" }
  /** The tab is in another window now, and it keeps the others. */
  | { kind: "losesTab" }
  /** The tab is in another window now, and this window closes. */
  | { kind: "closes" };

/** What leaves when the tab is let go, and the window it leaves behind or needs. */
type Carrying =
  /** The tab, rebuilt in the spare window. */
  | { goes: "tab"; spare: SpareWindow }
  /** The pressed window, with the spare window left in its place, or none for an only tab, which leaves nothing behind. */
  | { goes: "window"; spare: null | SpareWindow };

type Carry = Carrying & {
  /** Main reads the pointer itself and places what follows it, where a window can be placed. */
  readonly followsCursor: boolean;
  readonly from: BrowserWindow;
  readonly fromId: string;
  /** The point of a window under the pointer. */
  readonly grab: Point;
  isOffRow: boolean;
  /** The spare window has what the drag needs it to hold. */
  isSpareDressed: boolean;
  /** Filled the work area as the drag started, which the window it leaves behind goes on doing. */
  readonly isWindowMaximized: boolean;
  readonly moving: TabStanding;
  /** Where the window was. */
  readonly origin: Bounds;
  /**
   * The window whose strip an only tab's window was already over, which the tab
   * has not been carried to: it takes the tab only once the pointer has left that
   * strip.
   */
  overAtStart: BrowserWindow | null;
  phase: CarryPhase<BrowserWindow>;
  /** What goes with the pointer, off the row. An only tab has its window instead, and a move from a menu no pointer. */
  picture: null | TabPicture;
  point: null | Point;
  /** How far along the tab the press was. */
  readonly pointInTab: number;
  poll: NodeJS.Timeout | null;
  /** The window's size and place short of filling the screen, which a window of its own takes. */
  readonly size: Bounds;
};

/** A drag that came to nothing. */
const NONE: TabCarryEnd = { kind: "none" };

let carry: Carry | null = null;

/** A Wayland client cannot place its own window, so nothing could follow the pointer. */
function canPlaceWindows() {
  return (
    process.platform !== "linux" ||
    effectiveDisplayProtocol(
      resolveOzonePlatform(process.env.INSTRUMENT_OZONE_PLATFORM).platform,
      process.env.WAYLAND_DISPLAY,
      app.commandLine.getSwitchValue("ozone-platform"),
    ) !== "wayland"
  );
}

/** Whether a person has used a page the tab shows, one drawn inside its screens included. */
function isUsed({ hostedPages, pages }: TabStanding) {
  return getBrowserViewManager().isPageUsed([...pages, ...hostedPages]);
}

function tell(window: BrowserWindow, view: TabCarryView) {
  if (!window.isDestroyed()) {
    publisher.publish("window.tab-carry", {
      view,
      webContentsId: window.webContents.id,
    });
  }
}

/** What a window's strip draws of a tab held over it. */
function incomingView(
  { moving, pointInTab }: Carry,
  target: BrowserWindow,
  point: Point,
): TabCarryView {
  const { id, pathname } = moving.tab;
  return {
    clientX: point.x - target.getBounds().x,
    kind: "incoming",
    pointInTab,
    tab: { id, pathname },
  };
}

/** The drag's first state, the spare window ready, or none where there can be no drag. */
function beginCarry({
  at,
  grab,
  isOffRow,
  isOnlyTab,
  moving,
  pointInTab = 0,
  webContentsId,
}: {
  /** Where on the screen a press starts it. A move from a menu has no such place. */
  at?: Point;
  grab: Point;
  isOffRow: boolean;
  isOnlyTab: boolean;
  moving: TabStanding;
  pointInTab?: number;
  webContentsId: number;
}): Carry | null {
  stopCarry();
  const source = webContents.fromId(webContentsId);
  const from = source ? BrowserWindow.fromWebContents(source) : null;
  const fromId = from ? appWindowIdOfWindow(from) : undefined;
  const spare =
    from && fromId !== undefined && !isOnlyTab ? takeSpareWindow() : null;
  // A full-screen window stays, and with its only tab there is nothing to move.
  if (
    !from ||
    fromId === undefined ||
    (isOnlyTab ? from.isFullScreen() : !spare)
  ) {
    return null;
  }
  const canPlace = canPlaceWindows();
  const followsCursor = canPlace && !keepsOffScreen();
  const isFullScreen = from.isFullScreen();
  const isMaximized = from.isMaximized();
  const goes = whatGoes({
    canPlace,
    isFullScreen,
    isOnlyTab,
    isTabPageUsed: isUsed(moving),
  });
  const origin = from.getBounds();
  const started: Carry = {
    ...(goes === "tab" && spare
      ? { goes: "tab" as const, spare }
      : { goes: "window" as const, spare }),
    followsCursor,
    from,
    fromId,
    grab,
    isOffRow,
    isSpareDressed: false,
    isWindowMaximized: isMaximized,
    moving,
    origin,
    overAtStart:
      at && canPlace && isOnlyTab
        ? (windowsToLandOn(from, spare).find(
            (window) =>
              placeOnWindow(window.getBounds(), at, stripBandHeight()) ===
              "band",
          ) ?? null)
        : null,
    phase: { kind: "row" },
    picture: null,
    point: null,
    pointInTab,
    poll: null,
    size: isMaximized || isFullScreen ? from.getNormalBounds() : origin,
  };
  carry = started;
  if (spare) {
    tell(spare.window, { kind: "beneath" });
    spare.window.setBounds(goes === "window" ? origin : started.size);
  }
  return started;
}

/**
 * Starts a tab's drag, ahead of it leaving the row. The renderer holding the drag
 * says whether the tab is off its row, and main, which alone sees every window,
 * says which strip it is over and moves what follows the pointer. Off the row the
 * tab is out of its strip in the window it stays in, and a picture of it goes with
 * the pointer. Nothing changes hands until the tab is let go, so going back to the
 * row or Escape has nothing to undo. Answers whether the tab's strip closes up
 * behind it, which it can where there is something to go with the pointer.
 */
export function startTabCarry(
  start: Parameters<typeof beginCarry>[0] & { at: Point; pointInTab: number },
): { collapsesOffRow: boolean } {
  const started = beginCarry(start);
  if (!started) {
    return { collapsesOffRow: false };
  }
  if (started.followsCursor) {
    started.poll = setInterval(followCursor, FOLLOW_MS);
    if (started.spare) {
      started.picture = openTabPicture(started.from);
    }
  }
  return { collapsesOffRow: canPlaceWindows() && started.spare !== null };
}

/** Gives the spare window what it holds for this drag: the tabs left behind, or the tab. */
function dressSpare(current: Carry) {
  const { fromId, goes, moving, spare } = current;
  if (!spare || current.isSpareDressed) {
    return;
  }
  current.isSpareDressed = true;
  const contents = spare.window.webContents;
  if (goes === "tab") {
    tellWindowKeptState(spare.id, contents, APP_TABS_KEY, {
      recentlyClosed: [],
      selectedId: moving.tab.id,
      tabs: [moving.tab],
    });
    return;
  }
  for (const key of windowKeptKeys(fromId)) {
    // A page drawn inside a surface is that window's, and the spare draws its own.
    if (key !== APP_TABS_KEY && !isHostedPageKey(key)) {
      tellWindowKeptState(
        spare.id,
        contents,
        key,
        getWindowKeptState(fromId, key),
      );
    }
  }
  const model = keptTabsOf(fromId);
  const at = model.tabs.findIndex((each) => each.id === moving.tab.id);
  tellWindowKeptState(spare.id, contents, APP_TABS_KEY, {
    ...model,
    selectedId:
      model.selectedId === moving.tab.id
        ? (neighborAt(model.tabs, at)?.id ?? null)
        : model.selectedId,
    tabs: model.tabs.filter((each) => each.id !== moving.tab.id),
  });
}

/** Sends pages to the window that shows them now. */
function handPages(pages: readonly BrowserTargetId[], to: BrowserWindow) {
  if (!to.isDestroyed()) {
    const manager = getBrowserViewManager();
    for (const page of pages) {
      void manager.handOffGuest(page, to.webContents.id);
    }
  }
}

/** On screen and drawing, and nothing to press or see until it is wanted. */
function showSpare({ from, spare }: Carry) {
  if (!spare || spare.window.isVisible()) {
    return;
  }
  const { window } = spare;
  if (process.platform === "darwin" && from.isFullScreen()) {
    // A tab pulled out of a full-screen window has to show in that window's Space,
    // as a window over it and not one going full screen in a Space of its own.
    window.setFullScreenable(false);
    window.setVisibleOnAllWorkspaces(true, {
      skipTransformProcessType: true,
      visibleOnFullScreen: true,
    });
  }
  window.setIgnoreMouseEvents(true);
  setOpacity(window, 0);
  window.showInactive();
}

/** Resolves when a window has drawn what it was just told, or soon anyway. */
async function drawn(window: BrowserWindow) {
  if (window.isDestroyed()) {
    return;
  }
  await Promise.race([
    window.webContents
      .executeJavaScript(
        "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
      )
      .catch(() => undefined),
    new Promise((resolve) => {
      setTimeout(resolve, DRAWN_LIMIT_MS);
    }),
  ]);
}

/**
 * Resolves when a window told to take a tab has it up and has drawn it, or soon
 * anyway. Telling it reaches its page some time later, and until then it would
 * draw the tab it had.
 */
async function drawnWithTab(window: BrowserWindow, id: string, tab: Tab) {
  const limit = Date.now() + DRAWN_LIMIT_MS;
  while (keptTabsOf(id).selectedId !== tab.id && Date.now() < limit) {
    await new Promise((resolve) => {
      setTimeout(resolve, FOLLOW_MS);
    });
  }
  await drawn(window);
}

/** What a window's strip shows right now, for a page only now listening: a spare's is the one thing it can miss. */
export function tabCarryViewOf(
  webContentsId: number,
): TabCarryView | undefined {
  return carry?.spare?.webContentsId === webContentsId
    ? { kind: "beneath" }
    : undefined;
}

/** A window's word on where the tab held over its strip stands along it. */
export function placeTabCarry(webContentsId: number, index: number) {
  if (
    carry?.phase.kind === "docked" &&
    carry.phase.window.webContents.id === webContentsId
  ) {
    carry.phase.landsAt = index;
  }
}

/** The renderer's word on where the pointer is and whether the tab is off its row. */
export function noteTabCarry({
  isOffRow,
  ...point
}: Point & { isOffRow: boolean }) {
  if (!carry) {
    return;
  }
  carry.isOffRow = isOffRow;
  if (!carry.followsCursor) {
    carry.point = point;
  }
  updateCarry();
}

/** A window gone or crashed under the drag: its renderer can no longer end it. */
function isBroken({ from, spare }: Carry) {
  return [from, spare?.window].some(
    (window) =>
      window && (window.isDestroyed() || window.webContents.isCrashed()),
  );
}

function followCursor() {
  if (!carry || isBroken(carry)) {
    stopCarry();
    return;
  }
  const { x, y } = screen.getCursorScreenPoint();
  if (carry.point?.x !== x || carry.point.y !== y) {
    carry.point = { x, y };
    updateCarry();
  }
}

/** How tall the band a window's strip draws in stands, at the zoom it is drawn at. */
function stripBandHeight() {
  return TOOLBAR_HEIGHT * getAppZoom();
}

/**
 * The windows a carried tab could land in, front to back. A full-screen window on
 * macOS is in a Space of its own, out of sight of a tab carried on this one, and
 * its bounds would make the top of the screen its strip.
 */
function windowsToLandOn(from: BrowserWindow, spare: null | SpareWindow) {
  return getAppWindows().filter(
    (window) =>
      window !== from &&
      window !== spare?.window &&
      (window.isVisible() || keepsOffScreen()) &&
      !window.isMinimized() &&
      !(process.platform === "darwin" && window.isFullScreen()),
  );
}

/** Where the tab stands at a point, off its row. */
function hitTest(current: Carry, point: Point): CarryPhase<BrowserWindow> {
  const { from, origin, overAtStart, phase, spare } = current;
  // Without a real place for each window, as on Wayland, no other strip can be told apart.
  const others = canPlaceWindows()
    ? windowsToLandOn(from, spare)
        .filter((window) => window !== overAtStart)
        .map((window) => ({
          bounds: window.getBounds(),
          reach:
            phase.kind === "docked" && phase.window === window
              ? DOCKED_REACH_PX
              : 0,
          window,
        }))
    : [];
  return phaseAt({
    bandHeight: stripBandHeight(),
    from,
    point,
    windows: spare
      ? [{ bounds: origin, window: from }, ...others]
      : // An only tab's window is always under the pointer, and is no place to land.
        others,
  });
}

function updateCarry() {
  if (!carry || !carry.point) {
    return;
  }
  if (isBroken(carry)) {
    stopCarry();
    return;
  }
  const { from, followsCursor, overAtStart, phase, picture, point, spare } =
    carry;
  if (
    overAtStart &&
    (overAtStart.isDestroyed() ||
      placeOnWindow(overAtStart.getBounds(), point, stripBandHeight()) !==
        "band")
  ) {
    carry.overAtStart = null;
  }
  const next = carry.isOffRow
    ? hitTest(carry, point)
    : ({ kind: "row" } as const);
  if (!isSamePhase(phase, next)) {
    carry.phase = next;
    enterPhase(carry, phase, point);
  } else if (phase.kind === "docked") {
    tell(phase.window, incomingView(carry, phase.window, point));
  } else if (phase.kind === "free") {
    if (spare) {
      picture?.moveTo(point);
    } else if (followsCursor) {
      const { x, y } = windowBoundsAt(carry, point);
      from.setPosition(x, y);
    }
  }
}

/**
 * Where what opens for the release stands. A window's only tab has its window under
 * the pointer already, and leaves it there.
 */
function placeAtRelease(ending: Carry, at: Point | undefined) {
  if (!at || !canPlaceWindows()) {
    return undefined;
  }
  return ending.spare
    ? boundsAtRelease(
        at,
        ending.size,
        screen.getDisplayNearestPoint(at).workArea,
      )
    : windowBoundsAt(ending, at);
}

function windowBoundsAt({ grab, size }: Carry, point: Point) {
  const { workArea } = screen.getDisplayNearestPoint(point);
  const bounds = boundsUnderPointer(point, grab, size, workArea);
  // A window manager on Linux keeps a window a program moves on screen, and then
  // gives it the place it asked for when the button comes up. Keeping to the screen
  // here means the window stays where it is shown.
  return process.platform === "linux"
    ? {
        ...bounds,
        x: Math.max(
          workArea.x,
          Math.min(bounds.x, workArea.x + workArea.width - bounds.width),
        ),
        y: Math.max(
          workArea.y,
          Math.min(bounds.y, workArea.y + workArea.height - bounds.height),
        ),
      }
    : bounds;
}

/**
 * Shows the phase the drag just went into. Off its row the spare window gets what
 * it will hold, so that it is ready for the release. An only tab has no picture:
 * its window follows the pointer, and clears out of the way of a strip it is over,
 * where windows can be kept unseen.
 */
function enterPhase(
  current: Carry,
  left: CarryPhase<BrowserWindow>,
  point: Point,
) {
  const { followsCursor, from, phase, picture, spare } = current;
  if (left.kind === "docked") {
    tell(left.window, { kind: "row" });
  }
  if (phase.kind === "row") {
    picture?.hide();
    return;
  }
  dressSpare(current);
  if (followsCursor && canKeepWindowsUnseen()) {
    showSpare(current);
  }
  if (phase.kind === "docked") {
    picture?.hide();
    tell(phase.window, incomingView(current, phase.window, point));
    if (!spare) {
      setOpacity(from, 0);
    }
    return;
  }
  if (spare) {
    picture?.show(point);
  } else if (followsCursor) {
    setOpacity(from, 1);
    leaveMaximized(from);
    from.setBounds(windowBoundsAt(current, point));
  }
}

/**
 * Lets a maximized window take another size. On a Mac being maximized is only
 * where the window stands, and asking it to stop would animate.
 */
function leaveMaximized(window: BrowserWindow) {
  if (process.platform !== "darwin" && window.isMaximized()) {
    window.unmaximize();
  }
}

function putWindowBack({ from, isWindowMaximized, origin, size }: Carry) {
  if (from.isDestroyed()) {
    return;
  }
  if (isWindowMaximized) {
    // From its own size, which is what it comes back to if it is restored.
    from.setBounds(size);
    from.maximize();
  } else {
    from.setBounds(origin);
  }
}

/**
 * Lets the tab go. Only now does anything change hands: whichever side of the
 * move has less to lose is the side that opens afresh, the way a window does
 * coming back from a launch.
 */
export async function endTabCarry({
  canceled,
  point,
}: {
  canceled: boolean;
  point?: Point | undefined;
}): Promise<TabCarryEnd> {
  const ending = carry;
  if (!ending) {
    return NONE;
  }
  const at = ending.followsCursor
    ? screen.getCursorScreenPoint()
    : (point ?? ending.point ?? undefined);
  const phase =
    at && ending.isOffRow && !canceled && !isBroken(ending)
      ? hitTest(ending, at)
      : undefined;
  // The pointer can have moved on from a strip since it was last read.
  const left = ending.phase;
  if (
    left.kind === "docked" &&
    !(phase?.kind === "docked" && phase.window === left.window)
  ) {
    tell(left.window, { kind: "row" });
  }
  if (phase?.kind !== "free" && phase?.kind !== "docked") {
    stopCarry();
    return NONE;
  }
  try {
    const place = placeAtRelease(ending, at);
    return phase.kind === "free"
      ? await standAlone(ending, place)
      : await land(ending, phase.window, place);
  } catch (error) {
    // A window gone partway. Nothing holds the picture from here, and it stands over everything.
    ending.picture?.close();
    setOpacity(ending.from, 1);
    tell(ending.from, { kind: "row" });
    throw error;
  }
}

/**
 * Moves a tab as a menu asks: a drag let go straight away, through the same steps,
 * so a tab comes out of either the same way.
 */
export async function moveTabNow({
  isOnlyTab,
  moving,
  to,
  webContentsId,
}: {
  isOnlyTab: boolean;
  moving: TabStanding;
  to: TabMoveDestination;
  webContentsId: number;
}): Promise<TabCarryEnd> {
  const current = beginCarry({
    grab: { x: 0, y: 0 },
    isOffRow: true,
    isOnlyTab,
    moving,
    webContentsId,
  });
  if (!current) {
    return NONE;
  }
  const place = canPlaceWindows()
    ? { ...current.size, x: cascadedBounds().x, y: cascadedBounds().y }
    : undefined;
  if (to.kind === "new") {
    return standAlone(current, place);
  }
  const target = appWindowById(to.id);
  if (!target || target.isDestroyed()) {
    stopCarry();
    return NONE;
  }
  return land(current, target, place);
}

/** The tab is let go: nothing follows the pointer from here, and a picture still stands in until what it stood in for is up. */
function release(ending: Carry) {
  carry = null;
  if (ending.poll) {
    clearInterval(ending.poll);
    ending.poll = null;
  }
}

/** A spare window that now holds a person's tabs, and the pages it comes to show. */
function adoptSpare(spare: SpareWindow, pages: readonly BrowserTargetId[]) {
  tell(spare.window, { kind: "row" });
  adoptSpareWindow(spare);
  stopShowingEverywhere(spare);
  handPages(pages, spare.window);
}

/**
 * The tabs left behind are a window of their own now, as the one they came from
 * stood, and over it, so that nothing of that window changing is seen. It is a
 * shade short of opaque until that window has come out from under it.
 */
async function leaveOthersBehind(ending: Carry) {
  const { followsCursor, isWindowMaximized, moving, spare } = ending;
  if (!spare) {
    return;
  }
  // As the window has them now, with what opened or closed in it since it was dressed.
  ending.isSpareDressed = false;
  dressSpare(ending);
  if (followsCursor) {
    showSpare(ending);
    await drawn(spare.window);
    setOpacity(spare.window, SEE_THROUGH_OPACITY);
    spare.window.moveTop();
  }
  adoptSpare(spare, moving.neighborPages);
  if (isWindowMaximized && !spare.window.isMaximized()) {
    spare.window.maximize();
  }
}

/**
 * Tells the pressed window what it holds from here. A window's strip animates what
 * comes and goes, and this is no one's to watch, so it is told to stay still until
 * it has come out from under the window left in its place.
 */
function tellWhatItHolds({ from, fromId }: Carry, model: TabsModel) {
  tell(from, { kind: "reshaping" });
  tellWindowKeptState(fromId, from.webContents, APP_TABS_KEY, model);
}

/** Takes the pressed window to its place once it has drawn what it holds now, and brings it forward. */
async function placeWhenDrawn(
  { from, picture, spare }: Carry,
  place: Bounds | undefined,
  isPlaceMaximized = false,
) {
  await drawn(from);
  if (spare) {
    setOpacity(spare.window, 1);
  }
  if (from.isDestroyed()) {
    picture?.close();
    return;
  }
  leaveMaximized(from);
  if (place) {
    from.setBounds(place);
  }
  if (isPlaceMaximized && process.platform !== "darwin") {
    from.maximize();
  }
  setOpacity(from, 1);
  from.moveTop();
  from.focus();
  tell(from, { kind: "row" });
  closeOnceUp(picture, from);
}

/** Puts a picture away once the window it stood in for has had a frame to come up, so that neither is missing between them. */
function closeOnceUp(picture: null | TabPicture, window: BrowserWindow) {
  void drawn(window).then(() => {
    picture?.close();
  });
}

/** Let go in the open. */
async function standAlone(
  ending: Carry,
  place: Bounds | undefined,
): Promise<TabCarryEnd> {
  const { followsCursor, from, moving, picture } = ending;
  release(ending);
  if (ending.goes === "window") {
    if (!ending.spare) {
      setOpacity(from, 1);
      if (place) {
        leaveMaximized(from);
        from.setBounds(place);
      }
      from.focus();
      return NONE;
    }
    await leaveOthersBehind(ending);
    tellWindowKeptState(ending.fromId, from.webContents, COMPOSE_KEY, []);
    tellWhatItHolds(ending, {
      recentlyClosed: [],
      selectedId: moving.tab.id,
      tabs: [moving.tab],
    });
    void placeWhenDrawn(ending, place);
    return { kind: "keepsTab" };
  }
  const { spare } = ending;
  dressSpare(ending);
  if (place) {
    leaveMaximized(spare.window);
    spare.window.setBounds(place);
  }
  // A window that cannot be kept unseen is drawn as it comes up.
  if (followsCursor && canKeepWindowsUnseen()) {
    showSpare(ending);
    await drawn(spare.window);
  }
  adoptSpare(spare, moving.pages);
  if (!keepsOffScreen()) {
    setOpacity(spare.window, 1);
    spare.window.show();
    spare.window.focus();
    // A window of its own, standing as the one it came from does.
    if (from.isFullScreen()) {
      spare.window.setFullScreen(true);
    }
  }
  closeOnceUp(picture, spare.window);
  return { kind: "losesTab" };
}

/** Let go over another window's strip, which is showing the tab at the pointer. */
async function land(
  ending: Carry,
  target: BrowserWindow,
  place: Bounds | undefined,
): Promise<TabCarryEnd> {
  const targetId = appWindowIdOfWindow(target);
  if (targetId === undefined) {
    stopCarry();
    return NONE;
  }
  const { from, fromId, goes, moving, phase, picture, spare } = ending;
  const landsAt =
    phase.kind === "docked" && phase.window === target
      ? phase.landsAt
      : undefined;
  const isJoining =
    landsBy({
      goes,
      isTabPageUsed: isUsed(moving),
    }) === "joining" && sendTabToWindow(moving.tab, targetId, landsAt);
  // A page that cannot take the tab right now: the carried window can still take
  // on its strip, which needs nothing of that page.
  if (!isJoining && goes === "tab") {
    tell(target, { kind: "row" });
    return standAlone(ending, place);
  }
  release(ending);
  if (!isJoining) {
    return takeStrip(ending, target, targetId, landsAt);
  }
  handPages(moving.pages, target);
  // An only tab's window closes with nothing to come back to, its floats aside.
  if (!spare) {
    tellWindowKeptState(
      targetId,
      target.webContents,
      COMPOSE_KEY,
      mergeFloats(
        getWindowKeptState(targetId, COMPOSE_KEY),
        getWindowKeptState(fromId, COMPOSE_KEY),
      ),
    );
  }
  // Raised only now: until the tab is drawn there, the window shows it held.
  void drawnWithTab(target, targetId, moving.tab).then(() => {
    tell(target, { kind: "row" });
    picture?.close();
    if (!target.isDestroyed() && !keepsOffScreen()) {
      target.focus();
    }
    if (spare) {
      stopCarrySpare(spare);
    } else if (!from.isDestroyed()) {
      closeInto(from, target);
    }
  });
  return { kind: spare ? "losesTab" : "closes" };
}

/** Closes a window whose tabs went to another, and whose pages go after them, with their histories. */
function closeInto(closing: BrowserWindow, kept: BrowserWindow) {
  getBrowserViewManager().handOffGuestsOf(
    closing.webContents.id,
    kept.webContents.id,
  );
  closeEmptiedWindow(closing);
}

/**
 * The pressed window stays for the page in the tab, and takes on the tabs and the
 * rest of the window it was let go over, in that window's place.
 */
async function takeStrip(
  ending: Carry,
  target: BrowserWindow,
  targetId: string,
  landsAt: number | undefined,
): Promise<TabCarryEnd> {
  const { from, fromId, moving, spare } = ending;
  await leaveOthersBehind(ending);
  const targetModel = keptTabsOf(targetId);
  const tabs = targetModel.tabs.filter((each) => each.id !== moving.tab.id);
  tabs.splice(landsAt ?? tabs.length, 0, moving.tab);
  for (const key of new Set([
    ...windowKeptKeys(targetId),
    ...windowKeptKeys(fromId),
  ])) {
    if (key !== APP_TABS_KEY && !isHostedPageKey(key)) {
      const value = getWindowKeptState(targetId, key);
      tellWindowKeptState(
        fromId,
        from.webContents,
        key,
        // An only tab's window has its floats yet, where another's left them behind.
        key === COMPOSE_KEY && !spare
          ? mergeFloats(getWindowKeptState(fromId, key), value)
          : value,
      );
    }
  }
  tellWhatItHolds(ending, {
    recentlyClosed: [
      ...(spare ? [] : keptTabsOf(fromId).recentlyClosed),
      ...targetModel.recentlyClosed,
    ],
    selectedId: moving.tab.id,
    tabs,
  });
  void placeWhenDrawn(ending, target.getBounds(), target.isMaximized()).then(
    () => {
      if (!target.isDestroyed() && !from.isDestroyed()) {
        closeInto(target, from);
      }
    },
  );
  return { kind: "takesStrip" };
}

function stopShowingEverywhere({ window }: SpareWindow) {
  if (process.platform === "darwin" && !window.isDestroyed()) {
    window.setVisibleOnAllWorkspaces(false, { skipTransformProcessType: true });
    window.setFullScreenable(true);
  }
}

function stopCarrySpare(spare: null | SpareWindow) {
  if (spare) {
    stopShowingEverywhere(spare);
    tell(spare.window, { kind: "row" });
    returnSpareWindow(spare);
  }
}

/** Puts everything back as it was at the start of the drag. */
function stopCarry() {
  if (!carry) {
    return;
  }
  const stopping = carry;
  release(stopping);
  const { from, phase, picture, spare } = stopping;
  picture?.close();
  if (phase.kind === "docked") {
    tell(phase.window, { kind: "row" });
  }
  // Only an only tab's window has moved.
  if (!spare && phase.kind !== "row") {
    setOpacity(from, 1);
    putWindowBack(stopping);
  }
  stopCarrySpare(spare);
}
