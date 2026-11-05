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
import { APP_TABS_KEY, COMPOSE_KEY } from "@/shared/kept-state";
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
  boundsUnderPointer,
  carryView,
  type CarryPhase,
  dressesAtStart,
  isSamePhase,
  landsBy,
  mergeFloats,
  phaseAt,
  placeOnWindow,
  type Point,
  whatGoes,
} from "./tab-carry-rules";

/** How often main reads the cursor while a tab is carried: a window follows it at the display's pace. */
const FOLLOW_MS = 8;
/** How long a window waits for a tab that came to it to draw, before going ahead anyway. */
const DRAWN_LIMIT_MS = 400;
/**
 * A window wholly covered by an opaque one counts as out of sight on macOS and
 * stops drawing, and the spare under the carried window has to be drawn already
 * when that window moves off it.
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

/** What the window that held the press does as the tab is let go. */
export type TabCarryEnd =
  /** It keeps what it has: over its own strip, canceled, or it was the tab's only window. */
  | { kind: "none" }
  /** It keeps the tab alone: the others are in the window left behind. */
  | { kind: "keepsTab" }
  /** It keeps the tab and takes on the tabs of the window it landed on, which closes. */
  | { kind: "takesStrip"; model: TabsModel }
  /** The tab is in another window now, and it keeps the others. */
  | { kind: "losesTab" }
  /** The tab is in another window now, and this window closes. */
  | { kind: "closes" };

/** What goes with the pointer, and the window it leaves or needs. */
type Carrying =
  /** The tab, rebuilt in the spare window. */
  | { goes: "tab"; spare: SpareWindow }
  /** The pressed window, with the spare window beneath, or none for an only tab, which leaves nothing behind. */
  | { goes: "window"; spare: null | SpareWindow };

type Carry = Carrying & {
  /** Main reads the pointer and places windows itself, where a window can be placed. */
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
  /** Where the window was, and where a tab coming back finds it. */
  readonly origin: Bounds;
  /**
   * The window whose strip the press was already over, which the tab has not
   * been carried to: it takes the tab only once the pointer has left that strip.
   */
  overAtStart: BrowserWindow | null;
  phase: CarryPhase<BrowserWindow>;
  point: null | Point;
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

/**
 * A window of ours under the pointer takes the press's release on Linux, where the
 * window that took the press never hears it, and there is no window opacity to
 * keep one out of sight until it is wanted. So there only the pressed window goes
 * with the pointer, and a tab going to the spare window stays showing in its strip
 * until it is let go, as on Wayland.
 */
function canFollowWithAnotherWindow() {
  return process.platform !== "linux";
}

function tell(window: BrowserWindow, view: TabCarryView) {
  if (!window.isDestroyed()) {
    publisher.publish("window.tab-carry", {
      view,
      webContentsId: window.webContents.id,
    });
  }
}

/** The window under the pointer as the tab is held. */
function carriedWindow({ from, ...carrying }: Carry) {
  return carrying.goes === "tab" ? carrying.spare.window : from;
}

/** What a window's strip shows of the tab, as the drag stands. */
function viewFor(current: Carry, window: BrowserWindow, point: Point) {
  const { goes, moving, phase, spare } = current;
  return carryView({
    carried: carriedWindow(current),
    docked: () => {
      const target = phase.kind === "docked" ? phase.window : window;
      const targetId = appWindowIdOfWindow(target);
      return {
        clientX: point.x - target.getBounds().x,
        tabs:
          targetId === undefined
            ? []
            : keptTabsOf(targetId).tabs.map(({ id, pathname }) => ({
                id,
                pathname,
              })),
      };
    },
    goes,
    heldId: moving.tab.id,
    phase,
    spare: spare?.window ?? null,
    window,
  });
}

/** Tells the windows what the phase the drag just went into has them show. */
function showPhase(current: Carry, point: Point) {
  tell(current.from, viewFor(current, current.from, point));
  if (current.spare) {
    tell(current.spare.window, viewFor(current, current.spare.window, point));
  }
}

/** The drag's first state, the spare window ready, or none where there can be no drag. */
function beginCarry({
  at,
  grab,
  isOffRow,
  isOnlyTab,
  moving,
  webContentsId,
}: {
  /** Where on the screen a press starts it. A move from a menu has no such place. */
  at?: Point;
  grab: Point;
  isOffRow: boolean;
  isOnlyTab: boolean;
  moving: TabStanding;
  webContentsId: number;
}): Carry | null {
  stopCarry();
  const source = webContents.fromId(webContentsId);
  const from = source ? BrowserWindow.fromWebContents(source) : null;
  const fromId = from ? appWindowIdOfWindow(from) : undefined;
  const spare =
    from && fromId !== undefined && !isOnlyTab ? takeSpareWindow() : null;
  if (!from || fromId === undefined || (!isOnlyTab && !spare)) {
    return null;
  }
  const manager = getBrowserViewManager();
  const canPlace = canPlaceWindows();
  const isFullScreen = from.isFullScreen();
  const isMaximized = from.isMaximized();
  const goes = whatGoes({
    canPlace,
    isFullScreen,
    isOnlyTab,
    isPageUsedBehind: manager.hasUsedPage(webContentsId, moving.pages),
    isTabPageUsed: manager.isPageUsed(moving.pages),
  });
  const origin = from.getBounds();
  const started: Carry = {
    ...(goes === "tab" && spare
      ? { goes: "tab" as const, spare }
      : { goes: "window" as const, spare }),
    followsCursor:
      canPlace &&
      !keepsOffScreen() &&
      (goes === "window" || canFollowWithAnotherWindow()),
    from,
    fromId,
    grab,
    isOffRow,
    isSpareDressed: false,
    isWindowMaximized: isMaximized,
    moving,
    origin,
    overAtStart:
      at && canPlace
        ? (windowsToLandOn(from, spare).find(
            (window) =>
              placeOnWindow(window.getBounds(), at, stripBandHeight()) ===
              "band",
          ) ?? null)
        : null,
    phase: { kind: "row" },
    point: null,
    poll: null,
    size: isMaximized || isFullScreen ? from.getNormalBounds() : origin,
  };
  carry = started;
  if (spare) {
    tell(spare.window, { kind: "beneath" });
    spare.window.setBounds(goes === "window" ? origin : started.size);
    const floats = getWindowKeptState(fromId, COMPOSE_KEY);
    if (
      dressesAtStart({
        goes,
        hasFloats: Array.isArray(floats) && floats.length > 0,
        isSpareUp: spare.isUp,
        neighborPages: moving.neighborPages,
        pages: moving.pages,
      })
    ) {
      dressSpare(started);
    }
  }
  // GNOME on X11 says a window shown without focus "is ready", which a drag along
  // the row should not cost.
  if (started.followsCursor && process.platform !== "linux") {
    showSpare(started);
  }
  return started;
}

/**
 * Starts a tab's drag, ahead of it leaving the row, so that a window is ready by
 * the time it does. The renderer holding the drag says whether the tab is off its
 * row, and main, which alone sees every window, says which strip it is over and
 * moves the window. Nothing changes hands until the tab is let go, so going back
 * to the row or Escape undoes all of it. Answers what the strip does as the tab
 * leaves its row: collapses it, or stays off the row until main says otherwise.
 */
export function startTabCarry(
  start: Parameters<typeof beginCarry>[0] & { at: Point },
): { collapsesOffRow: boolean; staysOffRow: boolean } {
  const started = beginCarry(start);
  if (!started) {
    return { collapsesOffRow: false, staysOffRow: false };
  }
  if (started.followsCursor) {
    started.poll = setInterval(followCursor, FOLLOW_MS);
  }
  return {
    collapsesOffRow: started.goes === "tab" && started.followsCursor,
    staysOffRow: started.goes === "window",
  };
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
    if (key !== APP_TABS_KEY) {
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
    selectedId: neighborAt(model.tabs, at)?.id ?? null,
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

/** The pages that can move while the drag can still be undone: coming over is a reload. */
function unusedPages(pages: readonly BrowserTargetId[]) {
  const manager = getBrowserViewManager();
  return pages.filter((page) => !manager.isPageUsed([page]));
}

/** On screen and drawn, ready for the tab to leave its row: beneath the window, or see-through until it is wanted. */
function showSpare({ from, ...carrying }: Carry) {
  const { goes, spare } = carrying;
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
  // Only what the pointer is carrying while the tab is held, and nothing to press.
  window.setIgnoreMouseEvents(true);
  setOpacity(window, 0);
  window.showInactive();
  if (goes === "window") {
    from.moveTop();
    setOpacity(window, 1);
    setOpacity(from, SEE_THROUGH_OPACITY);
  }
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
  return carry?.spare?.webContentsId === webContentsId &&
    carry.phase.kind === "row"
    ? { kind: "beneath" }
    : undefined;
}

/** The carried window's word on where the tab stands in the strip it is held over. */
export function placeTabCarry(index: number) {
  if (carry?.phase.kind === "docked") {
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
      ? // Home is where the window was, whichever window stands there now.
        [{ bounds: origin, window: from }, ...others]
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
  const { overAtStart, phase, point } = carry;
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
    // Straight from one strip to another, the tab may stand at the same place
    // along it, which its window has no cause to say again.
    if (phase.kind === "docked" && next.kind === "docked") {
      next.landsAt = phase.landsAt;
    }
    carry.phase = next;
    void enterPhase(carry, point);
  } else if (phase.kind === "docked") {
    const carried = carriedWindow(carry);
    tell(carried, viewFor(carry, carried, point));
  } else if (phase.kind === "free" && carry.followsCursor && phase.isPlaced) {
    const { x, y } = windowBoundsAt(carry, point);
    carriedWindow(carry).setPosition(x, y);
  }
}

/** Where the carried window stands in the phase the drag is in. */
function placeFor(current: Carry, point: Point) {
  return current.phase.kind === "docked"
    ? current.phase.window.getBounds()
    : windowBoundsAt(current, point);
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

/** Undoes going off the row. */
function backToRow(current: Carry) {
  const { followsCursor, from, moving } = current;
  if (current.goes === "window") {
    putWindowBack(current);
    handPages(unusedPages(moving.neighborPages), from);
  } else if (followsCursor) {
    setOpacity(current.spare.window, 0);
    handPages(unusedPages(moving.pages), from);
  }
}

/** Takes a phase up, and resolves once the carried window stands where it should. */
async function enterPhase(current: Carry, point: Point) {
  const { followsCursor, goes, moving, phase, spare } = current;
  const window = carriedWindow(current);
  if (phase.kind === "row") {
    backToRow(current);
    showPhase(current, point);
    return;
  }
  dressSpare(current);
  showPhase(current, point);
  if (!followsCursor) {
    return;
  }
  if (goes === "tab") {
    handPages(unusedPages(moving.pages), window);
  } else if (spare) {
    handPages(unusedPages(moving.neighborPages), spare.window);
  }
  showSpare(current);
  // The window goes once it is drawn as it should be where it is going, and the
  // window it uncovers is drawn too, so that neither is seen catching up.
  await Promise.all([drawn(window), spare && drawn(spare.window)]);
  if (carry !== current || current.phase !== phase || window.isDestroyed()) {
    return;
  }
  leaveMaximized(window);
  window.setBounds(placeFor(current, current.point ?? point));
  if (phase.kind === "docked") {
    window.moveTop();
    // The window beneath has to go on drawing, for the tab to land in it.
    setOpacity(window, SEE_THROUGH_OPACITY);
    return;
  }
  phase.isPlaced = true;
  if (goes === "tab") {
    window.moveTop();
    setOpacity(window, 1);
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
export function endTabCarry({
  canceled,
  point,
}: {
  canceled: boolean;
  point?: Point | undefined;
}): TabCarryEnd {
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
  if (phase?.kind === "free") {
    return standAlone(ending, at);
  }
  if (phase?.kind === "docked") {
    return land(ending, phase.window, at);
  }
  stopCarry();
  return NONE;
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
  if (to.kind === "new") {
    const point = cascadedBounds();
    current.phase = { isPlaced: false, kind: "free" };
    await enterPhase(current, point);
    return carry === current ? standAlone(current, point) : NONE;
  }
  const target = appWindowById(to.id);
  if (!target || target.isDestroyed()) {
    stopCarry();
    return NONE;
  }
  const { width, x, y } = target.getBounds();
  // The far end of the strip, which is where a tab with no place along it goes.
  const point = { x: x + width, y };
  current.phase = { kind: "docked", window: target };
  await enterPhase(current, point);
  if (carry !== current) {
    return NONE;
  }
  if (target.isDestroyed()) {
    stopCarry();
    return NONE;
  }
  return land(current, target, point);
}

function stopFollowing(current: Carry) {
  if (current.poll) {
    clearInterval(current.poll);
    current.poll = null;
  }
  if (!current.from.isDestroyed()) {
    setOpacity(current.from, 1);
  }
}

/** The tab is let go: nothing follows the pointer from here. */
function release(ending: Carry) {
  carry = null;
  stopFollowing(ending);
}

/** A spare window that now holds a person's tabs, and the pages it comes to show. */
function adoptSpare(spare: SpareWindow, pages: readonly BrowserTargetId[]) {
  tell(spare.window, { kind: "row" });
  adoptSpareWindow(spare);
  stopShowingEverywhere(spare);
  handPages(pages, spare.window);
}

/** The tabs left behind are a window of their own now, as the one they came from stood. */
function leaveOthersBehind(ending: Carry) {
  if (ending.goes !== "window" || !ending.spare) {
    return;
  }
  const { followsCursor, isWindowMaximized, moving, spare } = ending;
  // Let go before the first look at the pointer, a spare on Linux is not up yet.
  if (followsCursor) {
    showSpare(ending);
  }
  // As the window has them now, with what opened or closed in it since it was dressed.
  ending.isSpareDressed = false;
  dressSpare(ending);
  adoptSpare(spare, moving.neighborPages);
  if (isWindowMaximized && !spare.window.isMaximized()) {
    spare.window.maximize();
  }
}

/** Let go in the open. */
function standAlone(ending: Carry, at: Point | undefined): TabCarryEnd {
  const { from, moving } = ending;
  release(ending);
  // Let go before the window had moved, or where it only goes now.
  if (at && canPlaceWindows()) {
    leaveMaximized(carriedWindow(ending));
    carriedWindow(ending).setBounds(windowBoundsAt(ending, at));
  }
  if (ending.goes === "window") {
    if (!ending.spare) {
      from.focus();
      return NONE;
    }
    leaveOthersBehind(ending);
    from.focus();
    return { kind: "keepsTab" };
  }
  const { spare } = ending;
  dressSpare(ending);
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
  return { kind: "losesTab" };
}

/**
 * Let go over another window's strip, where the carried window already stands
 * and draws both windows' tabs.
 */
function land(
  ending: Carry,
  target: BrowserWindow,
  at: Point | undefined,
): TabCarryEnd {
  const targetId = appWindowIdOfWindow(target);
  if (targetId === undefined) {
    stopCarry();
    return NONE;
  }
  const { fromId, goes, moving, phase, spare } = ending;
  const manager = getBrowserViewManager();
  const landsAt =
    phase.kind === "docked" && phase.window === target
      ? phase.landsAt
      : undefined;
  const isJoining =
    landsBy({
      goes,
      isTabPageUsed: manager.isPageUsed(moving.pages),
      isTargetPageUsed: manager.hasUsedPage(target.webContents.id),
    }) === "joining" && sendTabToWindow(moving.tab, targetId, landsAt);
  // A page that cannot take the tab right now: the carried window can still take
  // on its strip, which needs nothing of that page.
  if (!isJoining && goes === "tab") {
    return standAlone(ending, at);
  }
  release(ending);
  leaveOthersBehind(ending);
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
  const carriedAway = carriedWindow(ending);
  // Raised only now: until the tab is drawn there, the carried window shows it.
  void drawnWithTab(target, targetId, moving.tab).then(() => {
    if (!target.isDestroyed() && !keepsOffScreen()) {
      target.focus();
    }
    if (goes === "tab") {
      stopCarrySpare(spare);
    } else if (!carriedAway.isDestroyed()) {
      closeEmptiedWindow(carriedAway);
    }
  });
  return { kind: goes === "tab" ? "losesTab" : "closes" };
}

/** The carried window stays, and takes on the tabs and the rest of the window it stands over. */
function takeStrip(
  { from, fromId, moving, spare }: Carry,
  target: BrowserWindow,
  targetId: string,
  landsAt: number | undefined,
): TabCarryEnd {
  const targetModel = keptTabsOf(targetId);
  const tabs = targetModel.tabs.filter((each) => each.id !== moving.tab.id);
  tabs.splice(landsAt ?? tabs.length, 0, moving.tab);
  for (const key of new Set([
    ...windowKeptKeys(targetId),
    ...windowKeptKeys(fromId),
  ])) {
    if (key !== APP_TABS_KEY) {
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
  // Already there, unless it was let go before it had moved.
  leaveMaximized(from);
  from.setBounds(target.getBounds());
  closeEmptiedWindow(target);
  from.focus();
  return {
    kind: "takesStrip",
    model: {
      recentlyClosed: [
        ...(spare ? [] : keptTabsOf(fromId).recentlyClosed),
        ...targetModel.recentlyClosed,
      ],
      selectedId: moving.tab.id,
      tabs,
    },
  };
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
  const { from, phase, spare } = stopping;
  if (phase.kind !== "row" && !from.isDestroyed()) {
    backToRow(stopping);
    tell(from, { kind: "row" });
  }
  stopCarrySpare(spare);
}
