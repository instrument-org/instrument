import {
  effectiveDisplayProtocol,
  resolveOzonePlatform,
} from "@/electron-main/lib/ozone-platform";
import { getBrowserViewManager } from "@/electron-main/browser-view/manager";
import { publisher } from "@/electron-main/rpc/publisher";
import {
  getWindowKeptState,
  tellWindowKeptState,
} from "@/electron-main/stores/workspace/kept-state";
import { getAppZoom } from "@/electron-main/stores/workspace/window-state";
import {
  adoptSpareWindow,
  appWindowById,
  appWindowIdOfWindow,
  cascadedBounds,
  closeEmptiedWindow,
  getAppWindows,
  moveTabToWindow,
  returnSpareWindow,
  type SpareWindow,
  takeSpareWindow,
} from "@/electron-main/windows/app-window";
import { keepsOffScreen } from "@/electron-main/windows/on-screen";
import { TOOLBAR_HEIGHT } from "@/shared/constants";
import { WINDOW_KEPT_KEYS } from "@/shared/kept-state";
import {
  type Tab,
  TabIdSchema,
  TabSchema,
  type TabCarryView,
} from "@/shared/tabs";
import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import { app, BrowserWindow, screen, webContents } from "electron";
import { z } from "zod";

/** How often main reads the cursor while a tab is carried: a window follows it at the display's pace. */
const FOLLOW_MS = 8;
/** How long a window waits for a tab that came to it to draw, before going ahead anyway. */
const DRAWN_LIMIT_MS = 400;
/** The key a window keeps its strip of tabs under. */
const APP_TABS_KEY = "app-tabs.v2";
/** The key a window keeps its floating drafts and chats under. */
const COMPOSE_KEY = "compose.v2";
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
  if (process.platform !== "linux") {
    window.setOpacity(opacity);
  }
}

interface Point {
  x: number;
  y: number;
}

interface Bounds extends Point {
  height: number;
  width: number;
}

/** What the window that held the press does as the tab is let go. */
export type TabCarryEnd =
  /** It keeps what it has: over its own strip, canceled, or it was the tab's only window. */
  | { kind: "none" }
  /** It keeps the tab alone: the others are in the window left behind. */
  | { kind: "keepsTab" }
  /** It keeps the tab and takes on the tabs of the window it landed on, which closes. */
  | { kind: "takesStrip"; model: KeptTabs }
  /** The tab is in another window now, and it keeps the others. */
  | { kind: "losesTab" }
  /** The tab is in another window now, and this window closes. */
  | { kind: "closes" };

/**
 * Whether a point is on a window at all, and on the band its strip draws in.
 * `reach` is how far past its top and sides and below its strip that band goes.
 */
export function placeOnWindow(
  bounds: Bounds,
  point: Point,
  bandHeight: number,
  reach = 0,
): "band" | "body" | "off" {
  if (
    point.x < bounds.x - reach ||
    point.x >= bounds.x + bounds.width + reach ||
    point.y < bounds.y - reach ||
    point.y >= bounds.y + bounds.height
  ) {
    return "off";
  }
  return point.y - bounds.y < bandHeight + reach ? "band" : "body";
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
    const place = placeOnWindow(window.bounds, point, bandHeight, window.reach);
    if (place === "band") {
      return window === from ? { place: "none" } : { place: "band", window };
    }
    if (place === "body") {
      break;
    }
  }
  return { place: "new" };
}

/**
 * Where a window goes so the point it was grabbed at stays under the pointer,
 * the same size as the window the tab came from and no bigger than the screen.
 */
export function boundsUnderPointer(
  point: Point,
  grab: Point,
  size: { height: number; width: number },
  workArea: { height: number; width: number },
): Bounds {
  return {
    height: Math.min(size.height, workArea.height),
    width: Math.min(size.width, workArea.width),
    x: Math.round(point.x - grab.x),
    y: Math.round(point.y - grab.y),
  };
}

/**
 * Where a tab being dragged is, which everything it shows follows from: on its
 * own row, free of every strip with a window under the pointer, or held in
 * another window's strip. Each effect belongs to going in or out of a phase.
 */
export type CarryPhase<W> =
  | { kind: "docked"; window: W }
  | { kind: "free" }
  | { kind: "row" };

export function carryPhase<W>(
  isOffRow: boolean,
  place: "band" | "new" | "none",
  window: undefined | W,
): CarryPhase<W> {
  if (!isOffRow || place === "none") {
    return { kind: "row" };
  }
  return place === "band" && window !== undefined
    ? { kind: "docked", window }
    : { kind: "free" };
}

function isSamePhase<W>(a: CarryPhase<W>, b: CarryPhase<W>) {
  return (
    a.kind === b.kind &&
    (a.kind !== "docked" || (b.kind === "docked" && a.window === b.window))
  );
}

interface WindowForCarry {
  bounds: Bounds;
  /** How far past its strip it still counts as over it. */
  reach?: number;
}

/** What a tab takes to another window if it goes there: the tab, and the pages that come with it. */
interface Moving {
  /** The pages of the tab that comes up in its place in the window left behind. */
  neighborPages: BrowserTargetId[];
  pages: BrowserTargetId[];
  tab: Tab;
}

/**
 * What goes with the pointer. The window that held the press, by default: its
 * renderer already has the tab as it is, page and all, so the tab is simply left
 * alone with the pointer and the spare window opens beneath on the tabs it leaves
 * behind. The tab goes instead, rebuilt in the spare window with the pressed window
 * staying where it is, only where that costs less or there is no choice.
 */
export function whatGoes({
  canPlace,
  isFullScreen,
  isOnlyTab,
  isPageUsedBehind,
  isTabPageUsed,
}: {
  canPlace: boolean;
  isFullScreen: boolean;
  isOnlyTab: boolean;
  isPageUsedBehind: boolean;
  isTabPageUsed: boolean;
}): "tab" | "window" {
  if (isOnlyTab) {
    return "window";
  }
  return !canPlace || isFullScreen || (isPageUsedBehind && !isTabPageUsed)
    ? "tab"
    : "window";
}

/**
 * Whether the spare window has its tabs as the drag starts, so that it is ready the
 * moment the tab leaves its row. A page can be in one renderer at a time and comes
 * back afresh in another, which no drag along the row should cost it, so a spare
 * window that would ask for a page waits until the tab has really left. One just
 * opened cannot wait: it reads its tabs once as it loads, and hears nothing until
 * its page is up.
 */
export function dressesAtStart({
  floats,
  goes,
  isSpareUp,
  neighborPages,
  pages,
}: {
  floats: unknown;
  goes: "tab" | "window";
  isSpareUp: boolean;
  neighborPages: readonly unknown[];
  pages: readonly unknown[];
}) {
  if (!isSpareUp) {
    return true;
  }
  if (goes === "tab") {
    return pages.length === 0;
  }
  return (
    !(Array.isArray(floats) && floats.length > 0) && neighborPages.length === 0
  );
}

const FloatsSchema = z
  .array(
    z.looseObject({
      chatId: z.string().optional(),
      draftId: z.string().optional(),
    }),
  )
  .catch([]);

/** Two windows' floats as one, a chat or a draft floating in both counted once. */
export function mergeFloats(kept: unknown, more: unknown) {
  const seen = new Set<string | undefined>();
  return [...FloatsSchema.parse(kept), ...FloatsSchema.parse(more)].filter(
    ({ chatId, draftId }) => {
      const key = draftId ?? chatId;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    },
  );
}

/**
 * Who reopens when a tab is let go over another window's strip. The window under
 * the pointer stays and the other reopens, unless the window held over has a used
 * page and the tab has none: then the tab goes to it. With used pages on both
 * sides the tab in hand wins.
 */
export function landsBy({
  goes,
  isTabPageUsed,
  isTargetPageUsed,
}: {
  goes: "tab" | "window";
  isTabPageUsed: boolean;
  isTargetPageUsed: boolean;
}): "joining" | "takingStrip" {
  return goes === "tab" || (isTargetPageUsed && !isTabPageUsed)
    ? "joining"
    : "takingStrip";
}

interface Carry {
  /** Main reads the pointer and places windows itself, where a window can be placed. */
  followsCursor: boolean;
  from: BrowserWindow;
  fromId: string;
  goes: "tab" | "window";
  /** The point of a window under the pointer. */
  grab: Point;
  isOffRow: boolean;
  isOnlyTab: boolean;
  /** The carried window stands where the pointer holds it, drawn as it should be there. */
  isPlaced: boolean;
  /** The spare window has what the drag needs it to hold. */
  isSpareDressed: boolean;
  /** Filled the work area as the drag started, which the window it leaves behind goes on doing. */
  isWindowMaximized: boolean;
  /** Where the tab stands in the strip it is held over, as the window showing it says. */
  landsAt: number | undefined;
  moving: Moving;
  /** Where the window was, and where a tab coming back finds it. */
  origin: Bounds;
  /**
   * The window whose strip the press was already over, which the tab has not
   * been carried to: it takes the tab only once the pointer has left that strip.
   */
  overAtStart: BrowserWindow | null;
  phase: CarryPhase<BrowserWindow>;
  point: null | Point;
  poll: NodeJS.Timeout | null;
  /** The window's size and place short of filling the screen, which a window of its own takes. */
  size: Bounds;
  /** None for an only tab, which leaves nothing behind. */
  spare: null | SpareWindow;
}

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

const KeptTabsSchema = z.object({
  recentlyClosed: z
    .array(TabSchema.extend({ index: z.number().optional() }))
    .catch([]),
  selectedId: TabIdSchema.nullable().catch(null),
  tabs: z.array(TabSchema).catch([]),
});
type KeptTabs = z.output<typeof KeptTabsSchema>;

function keptTabsOf(windowId: string): KeptTabs {
  const parsed = KeptTabsSchema.safeParse(
    getWindowKeptState(windowId, APP_TABS_KEY),
  );
  return parsed.success
    ? parsed.data
    : { recentlyClosed: [], selectedId: null, tabs: [] };
}

function neighborOf(tabs: readonly Tab[], tab: Tab) {
  const at = tabs.findIndex((each) => each.id === tab.id);
  return tabs[at + 1] ?? tabs[at - 1];
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
function carriedWindow({ from, goes, spare }: Carry) {
  return goes === "tab" && spare ? spare.window : from;
}

/**
 * Starts a tab's drag, ahead of it leaving the row, so that a window is ready by
 * the time it does. The renderer holding the drag says whether the tab is off its
 * row, and main, which alone sees every window, says which strip it is over and
 * moves the window. Nothing changes hands until the tab is let go, so going back
 * to the row or Escape undoes all of it. Answers what the strip does as the tab
 * leaves its row: collapses it, or stays off the row until main says otherwise.
 */
export function startTabCarry({
  at,
  grab,
  isHeld = true,
  isOffRow,
  isOnlyTab,
  moving,
  webContentsId,
}: {
  /** Where on the screen the drag starts. */
  at?: Point | undefined;
  grab: Point;
  /** A pointer has it, which main follows. A move from a menu has none. */
  isHeld?: boolean;
  isOffRow: boolean;
  isOnlyTab: boolean;
  moving: Moving;
  webContentsId: number;
}): { collapsesOffRow: boolean; staysOffRow: boolean } {
  stopCarry();
  const source = webContents.fromId(webContentsId);
  const from = source ? BrowserWindow.fromWebContents(source) : null;
  const fromId = from ? appWindowIdOfWindow(from) : undefined;
  const spare =
    from && fromId !== undefined && !isOnlyTab ? takeSpareWindow() : null;
  if (!from || fromId === undefined || (!isOnlyTab && !spare)) {
    return { collapsesOffRow: false, staysOffRow: false };
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
    followsCursor:
      canPlace &&
      !keepsOffScreen() &&
      (goes === "window" || canFollowWithAnotherWindow()),
    from,
    fromId,
    goes,
    grab,
    isOffRow,
    isOnlyTab,
    isPlaced: false,
    isSpareDressed: false,
    isWindowMaximized: isMaximized,
    landsAt: undefined,
    moving,
    origin,
    overAtStart:
      at && canPlace
        ? (windowsToLandOn({ from, spare }).find(
            (window) =>
              placeOnWindow(window.getBounds(), at, stripBandHeight()) ===
              "band",
          ) ?? null)
        : null,
    phase: { kind: "row" },
    point: null,
    poll: null,
    size: isMaximized || isFullScreen ? from.getNormalBounds() : origin,
    spare,
  };
  carry = started;
  if (spare) {
    tell(spare.window, { kind: "beneath" });
    spare.window.setBounds(goes === "window" ? origin : started.size);
    if (
      dressesAtStart({
        floats: getWindowKeptState(fromId, COMPOSE_KEY),
        goes,
        isSpareUp: spare.isUp,
        neighborPages: moving.neighborPages,
        pages: moving.pages,
      })
    ) {
      dressSpare(started);
    }
  }
  if (started.followsCursor) {
    // GNOME on X11 says a window shown without focus "is ready", which a drag along
    // the row should not cost.
    if (process.platform !== "linux") {
      showSpare(started);
    }
    if (isHeld) {
      started.poll = setInterval(followCursor, FOLLOW_MS);
    }
  }
  return {
    collapsesOffRow: goes === "tab" && started.followsCursor,
    staysOffRow: goes === "window",
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
  for (const key of WINDOW_KEPT_KEYS) {
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
  tellWindowKeptState(spare.id, contents, APP_TABS_KEY, {
    ...model,
    selectedId: neighborOf(model.tabs, moving.tab)?.id ?? null,
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
function showSpare({ from, goes, spare }: Carry) {
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
  const spare = carry?.spare;
  return spare &&
    !spare.window.isDestroyed() &&
    spare.window.webContents.id === webContentsId &&
    carry?.phase.kind === "row"
    ? { kind: "beneath" }
    : undefined;
}

/** The carried window's word on where the tab stands in the strip it is held over. */
export function placeHeldTab(index: number) {
  if (carry) {
    carry.landsAt = index;
  }
}

/** The renderer's word on where the pointer is and whether the tab is off its row. */
export function moveTabCarry({
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

/** The windows a carried tab could land in, front to back. */
function windowsToLandOn({ from, spare }: Pick<Carry, "from" | "spare">) {
  return getAppWindows().filter(
    (window) =>
      window !== from && window !== spare?.window && !window.isMinimized(),
  );
}

function hitTest(current: Carry, point: Point | undefined, canceled = false) {
  const { from, isOnlyTab, origin, overAtStart, phase } = current;
  // Home is where the window was, whichever window stands there now.
  const home = { bounds: origin, window: from };
  // Without a real place for each window, as on Wayland, no other strip can be told apart.
  const others = canPlaceWindows()
    ? windowsToLandOn(current)
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
  return carryDestination({
    bandHeight: stripBandHeight(),
    canceled,
    from: home,
    point,
    // An only tab's window is always under the pointer, and is no place to land.
    windows: isOnlyTab ? others : [home, ...others],
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
  const { overAtStart } = carry;
  if (
    overAtStart &&
    (overAtStart.isDestroyed() ||
      placeOnWindow(overAtStart.getBounds(), carry.point, stripBandHeight()) !==
        "band")
  ) {
    carry.overAtStart = null;
  }
  const { place, window } = carry.isOffRow
    ? hitTest(carry, carry.point)
    : { place: "none" as const, window: undefined };
  const next = carryPhase(carry.isOffRow, place, window?.window);
  if (!isSamePhase(carry.phase, next)) {
    carry.phase = next;
    void enterPhase(carry, carry.point);
  } else if (carry.phase.kind === "docked") {
    tellJoined(carry, carry.phase.window, carry.point);
  } else if (
    carry.phase.kind === "free" &&
    carry.followsCursor &&
    carry.isPlaced
  ) {
    const { x, y } = windowBoundsAt(carry, carry.point);
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

function tellJoined(current: Carry, target: BrowserWindow, point: Point) {
  const targetId = appWindowIdOfWindow(target);
  if (targetId !== undefined) {
    tell(carriedWindow(current), {
      clientX: point.x - target.getBounds().x,
      heldId: current.moving.tab.id,
      kind: "joined",
      tabs: keptTabsOf(targetId).tabs.map(({ id, pathname }) => ({
        id,
        pathname,
      })),
    });
  }
}

/** Takes a phase up, and resolves once the carried window stands where it should. */
async function enterPhase(current: Carry, point: Point) {
  const { followsCursor, from, goes, moving, phase, spare } = current;
  const window = carriedWindow(current);
  current.isPlaced = false;
  if (phase.kind === "row") {
    if (spare) {
      tell(spare.window, { kind: "beneath" });
    }
    if (goes === "window") {
      putWindowBack(current);
      tell(from, { kind: "row" });
      handPages(unusedPages(moving.neighborPages), from);
    } else if (spare && followsCursor) {
      setOpacity(spare.window, 0);
      handPages(moving.pages, from);
    }
    return;
  }
  dressSpare(current);
  if (spare) {
    tell(spare.window, { kind: "row" });
  }
  if (phase.kind === "docked") {
    tellJoined(current, phase.window, point);
  } else {
    current.landsAt = undefined;
    if (goes === "window") {
      tell(from, { heldId: moving.tab.id, kind: "alone" });
    }
  }
  if (!followsCursor) {
    return;
  }
  if (goes === "tab") {
    handPages(moving.pages, window);
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
  current.isPlaced = true;
  leaveMaximized(window);
  window.setBounds(placeFor(current, current.point ?? point));
  if (phase.kind === "docked") {
    window.moveTop();
    // The window beneath has to go on drawing, for the tab to land in it.
    setOpacity(window, SEE_THROUGH_OPACITY);
    return;
  }
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
    return { kind: "none" };
  }
  if (isBroken(ending)) {
    stopCarry();
    return { kind: "none" };
  }
  const at = ending.followsCursor
    ? screen.getCursorScreenPoint()
    : (point ?? ending.point ?? undefined);
  const { place, window } = ending.isOffRow
    ? hitTest(ending, at, canceled)
    : { place: "none" as const, window: undefined };
  const targetId = window && appWindowIdOfWindow(window.window);
  if (place === "new") {
    return standAlone(ending, at);
  }
  if (place === "band" && window && targetId !== undefined) {
    return land(ending, window.window, targetId, at);
  }
  stopCarry();
  return { kind: "none" };
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
  moving: Moving;
  to: { id: string; kind: "window" } | { kind: "new" };
  webContentsId: number;
}): Promise<TabCarryEnd> {
  startTabCarry({
    grab: { x: 0, y: 0 },
    isHeld: false,
    isOffRow: true,
    isOnlyTab,
    moving,
    webContentsId,
  });
  const current = carry;
  if (!current) {
    return { kind: "none" };
  }
  if (to.kind === "new") {
    const point = cascadedBounds();
    current.phase = { kind: "free" };
    await enterPhase(current, point);
    return carry === current ? standAlone(current, point) : { kind: "none" };
  }
  const target = appWindowById(to.id);
  if (!target || target.isDestroyed()) {
    stopCarry();
    return { kind: "none" };
  }
  const { width, x, y } = target.getBounds();
  // The far end of the strip, which is where a tab with no place along it goes.
  const point = { x: x + width, y };
  current.phase = { kind: "docked", window: target };
  await enterPhase(current, point);
  if (carry !== current) {
    return { kind: "none" };
  }
  if (target.isDestroyed()) {
    stopCarry();
    return { kind: "none" };
  }
  return land(current, target, to.id, point);
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

/** The tabs left behind are a window of their own now, as the one they came from stood. */
function leaveOthersBehind(ending: Carry) {
  const { goes, isWindowMaximized, moving, spare } = ending;
  if (!spare || goes !== "window") {
    return;
  }
  // As the window has them now, with what opened or closed in it since it was dressed.
  ending.isSpareDressed = false;
  dressSpare(ending);
  tell(spare.window, { kind: "row" });
  adoptSpareWindow(spare);
  stopShowingEverywhere(spare);
  if (isWindowMaximized && !spare.window.isMaximized()) {
    spare.window.maximize();
  }
  handPages(moving.neighborPages, spare.window);
}

/** Let go in the open. */
function standAlone(ending: Carry, at: Point | undefined): TabCarryEnd {
  const { from, goes, isOnlyTab, moving, spare } = ending;
  carry = null;
  stopFollowing(ending);
  // Let go before the window had moved, or where it only goes now.
  if (at && canPlaceWindows()) {
    leaveMaximized(carriedWindow(ending));
    carriedWindow(ending).setBounds(windowBoundsAt(ending, at));
  }
  if (isOnlyTab) {
    from.focus();
    return { kind: "none" };
  }
  if (goes === "window") {
    leaveOthersBehind(ending);
    from.focus();
    return { kind: "keepsTab" };
  }
  if (spare) {
    dressSpare(ending);
    tell(spare.window, { kind: "row" });
    adoptSpareWindow(spare);
    stopShowingEverywhere(spare);
    handPages(moving.pages, spare.window);
    if (!keepsOffScreen()) {
      setOpacity(spare.window, 1);
      spare.window.show();
      spare.window.focus();
      // A window of its own, standing as the one it came from does.
      if (from.isFullScreen()) {
        spare.window.setFullScreen(true);
      }
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
  targetId: string,
  at: Point | undefined,
): TabCarryEnd {
  const { goes, isOnlyTab, landsAt, moving, spare } = ending;
  const manager = getBrowserViewManager();
  const by = landsBy({
    goes,
    isTabPageUsed: manager.isPageUsed(moving.pages),
    isTargetPageUsed: manager.hasUsedPage(target.webContents.id),
  });
  if (by === "takingStrip") {
    carry = null;
    stopFollowing(ending);
    leaveOthersBehind(ending);
    return takeStrip(ending, target, targetId);
  }
  const { moved } = moveTabToWindow(
    moving.tab,
    { id: targetId, index: landsAt, kind: "window" },
    { isQuiet: true },
  );
  if (!moved) {
    // Its page cannot take the tab right now. The carried window can still take
    // on its strip, which needs nothing of that page.
    if (goes === "tab") {
      return standAlone(ending, at);
    }
    carry = null;
    stopFollowing(ending);
    leaveOthersBehind(ending);
    return takeStrip(ending, target, targetId);
  }
  carry = null;
  stopFollowing(ending);
  leaveOthersBehind(ending);
  handPages(moving.pages, target);
  // An only tab's window closes with nothing to come back to, its floats aside.
  if (isOnlyTab) {
    tellWindowKeptState(
      targetId,
      target.webContents,
      COMPOSE_KEY,
      mergeFloats(
        getWindowKeptState(targetId, COMPOSE_KEY),
        getWindowKeptState(ending.fromId, COMPOSE_KEY),
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
  { from, fromId, isOnlyTab, landsAt, moving }: Carry,
  target: BrowserWindow,
  targetId: string,
): TabCarryEnd {
  const targetModel = keptTabsOf(targetId);
  const tabs = targetModel.tabs.filter((each) => each.id !== moving.tab.id);
  tabs.splice(landsAt ?? tabs.length, 0, moving.tab);
  for (const key of WINDOW_KEPT_KEYS) {
    if (key !== APP_TABS_KEY) {
      const value = getWindowKeptState(targetId, key);
      tellWindowKeptState(
        fromId,
        from.webContents,
        key,
        // An only tab's window has its floats yet, where another's left them behind.
        key === COMPOSE_KEY && isOnlyTab
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
        ...(isOnlyTab ? keptTabsOf(fromId).recentlyClosed : []),
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
  carry = null;
  stopFollowing(stopping);
  const { from, goes, moving, phase, spare } = stopping;
  if (phase.kind !== "row" && !from.isDestroyed()) {
    tell(from, { kind: "row" });
    if (goes === "window") {
      putWindowBack(stopping);
      handPages(unusedPages(moving.neighborPages), from);
    } else {
      handPages(moving.pages, from);
    }
  }
  stopCarrySpare(spare);
}
