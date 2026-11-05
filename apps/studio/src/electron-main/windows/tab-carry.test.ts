import { type BrowserTargetId } from "@instrument-org/workspace/electron";
import { type Tab, type TabId } from "@/shared/tabs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** A window as the drag sees it, which records what was done to it. */
function fakeWindow(id: number, name: string, bounds = BOUNDS) {
  const window = {
    bounds: { ...bounds },
    closed: false,
    destroyed: false,
    focused: 0,
    full: false,
    getBounds: () => window.bounds,
    getNormalBounds: () => window.bounds,
    id,
    isDestroyed: () => window.destroyed,
    isFullScreen: () => window.full,
    isMaximized: () => false,
    isMinimized: () => false,
    isVisible: () => window.visible,
    focus: () => {
      window.focused += 1;
    },
    maximize: vi.fn(),
    moveTop: vi.fn(),
    name,
    opacity: 1,
    setBounds: (next: typeof bounds) => {
      window.bounds = { ...next };
    },
    setFullScreen: vi.fn(),
    setFullScreenable: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setOpacity: (opacity: number) => {
      if (window.destroyed) {
        throw new Error("Object has been destroyed");
      }
      window.opacity = opacity;
    },
    setPosition: (x: number, y: number) => {
      window.bounds = { ...window.bounds, x, y };
    },
    setVisibleOnAllWorkspaces: vi.fn(),
    show: () => {
      window.visible = true;
    },
    showInactive: () => {
      window.visible = true;
    },
    unmaximize: vi.fn(),
    visible: true,
    webContents: {
      executeJavaScript: () => Promise.resolve(true),
      id,
      isCrashed: () => false,
    },
  };
  return window;
}
type FakeWindow = ReturnType<typeof fakeWindow>;

const BOUNDS = { height: 800, width: 1200, x: 100, y: 100 };

const state = vi.hoisted(() => ({
  appWindows: [] as unknown[],
  cursor: { x: 0, y: 0 },
  kept: new Map<string, Map<string, unknown>>(),
  listening: true,
  offScreen: false,
  platform: "darwin" as NodeJS.Platform,
  sent: [] as unknown[],
  spare: null as null | {
    id: string;
    isUp: boolean;
    webContentsId: number;
    window: unknown;
  },
  taken: 0,
  usedPages: new Set<string>(),
  views: [] as { view: { kind: string }; webContentsId: number }[],
  windows: new Map<number, unknown>(),
}));

const picture = vi.hoisted(() => ({
  close: vi.fn(),
  hide: vi.fn(),
  moveTo: vi.fn(),
  show: vi.fn(),
}));
const openTabPicture = vi.hoisted(() => vi.fn(() => picture));
const handOffGuest = vi.hoisted(() => vi.fn());
const adoptSpareWindow = vi.hoisted(() => vi.fn());
const returnSpareWindow = vi.hoisted(() => vi.fn());
const closeEmptiedWindow = vi.hoisted(() => vi.fn());
const zoom = vi.hoisted(() => ({ value: 1 }));

vi.mock("./tab-picture", () => ({ openTabPicture }));
vi.mock("electron", () => ({
  app: { commandLine: { getSwitchValue: () => "" } },
  BrowserWindow: {
    fromWebContents: (source: { id: number }) => state.windows.get(source.id),
  },
  screen: {
    getCursorScreenPoint: () => state.cursor,
    getDisplayNearestPoint: () => ({
      workArea: { height: 2000, width: 3000, x: 0, y: 0 },
    }),
  },
  webContents: { fromId: (id: number) => ({ id }) },
}));
vi.mock("@/electron-main/lib/ozone-platform", () => ({
  effectiveDisplayProtocol: () => "x11",
  resolveOzonePlatform: () => ({ platform: "x11" }),
}));
vi.mock("@/electron-main/browser-view/manager", () => ({
  getBrowserViewManager: () => ({
    handOffGuest,
    isPageUsed: (pages: string[]) =>
      pages.some((page) => state.usedPages.has(page)),
  }),
}));
vi.mock("@/electron-main/rpc/publisher", () => ({
  publisher: {
    publish: (_channel: string, event: (typeof state.views)[number]) => {
      state.views.push(event);
    },
  },
}));
vi.mock("@/electron-main/stores/workspace/kept-state", () => {
  const of = (id: string) => {
    const known = state.kept.get(id) ?? new Map<string, unknown>();
    state.kept.set(id, known);
    return known;
  };
  return {
    getWindowKeptState: (id: string, key: string) => of(id).get(key),
    tellWindowKeptState: (
      id: string,
      _contents: unknown,
      key: string,
      value: unknown,
    ) => {
      of(id).set(key, value);
    },
    windowKeptKeys: (id: string) => [...of(id).keys()],
  };
});
vi.mock("@/electron-main/stores/workspace/window-state", () => ({
  getAppZoom: () => zoom.value,
}));
vi.mock("@/electron-main/windows/on-screen", () => ({
  keepsOffScreen: () => state.offScreen,
}));
vi.mock("@/electron-main/windows/app-window", () => ({
  adoptSpareWindow,
  appWindowById: (id: string) =>
    (state.appWindows as { name: string }[]).find(
      (window) => window.name === id,
    ),
  appWindowIdOfWindow: (window: { name: string }) => window.name,
  cascadedBounds: () => ({ ...BOUNDS, x: 126, y: 126 }),
  closeEmptiedWindow,
  getAppWindows: () => state.appWindows,
  keptTabsOf: (id: string) =>
    state.kept.get(id)?.get("app-tabs.v2") ?? {
      recentlyClosed: [],
      selectedId: null,
      tabs: [],
    },
  returnSpareWindow,
  sendTabToWindow: (tab: unknown, id: string, index?: number) => {
    if (!state.listening) {
      return false;
    }
    state.sent.push({ id, index, tab });
    state.kept.get(id)?.set("app-tabs.v2", {
      recentlyClosed: [],
      selectedId: (tab as Tab).id,
      tabs: [tab],
    });
    return true;
  },
  takeSpareWindow: () => {
    state.taken += 1;
    return state.spare;
  },
}));

const { endTabCarry, moveTabNow, noteTabCarry, placeTabCarry, startTabCarry } =
  await import("./tab-carry");

const PLATFORM = process.platform;
const asTab = (id: string) => ({ id: id as TabId, pathname: `/${id}` }) as Tab;
const page = (id: string) => id as BrowserTargetId;
const IN_THE_OPEN = { x: 1500, y: 1500 };
const OVER_STRIP = { x: 1600, y: 120 };

let from: FakeWindow;
let spareWindow: FakeWindow;
let other: FakeWindow;

function setUp({
  platform = "darwin" as NodeJS.Platform,
  tabs = ["a", "b"],
  withOther = true,
} = {}) {
  Object.defineProperty(process, "platform", { value: platform });
  from = fakeWindow(1, "from");
  spareWindow = fakeWindow(2, "spare");
  spareWindow.visible = false;
  other = fakeWindow(3, "other", { ...BOUNDS, x: 1400 });
  state.appWindows = withOther ? [from, other] : [from];
  state.windows = new Map([
    [1, from],
    [2, spareWindow],
    [3, other],
  ]);
  state.spare = {
    id: "spare",
    isUp: true,
    webContentsId: 2,
    window: spareWindow,
  };
  state.kept = new Map([
    [
      "from",
      new Map<string, unknown>([
        [
          "app-tabs.v2",
          { recentlyClosed: [], selectedId: "a", tabs: tabs.map(asTab) },
        ],
      ]),
    ],
    [
      "other",
      new Map<string, unknown>([
        [
          "app-tabs.v2",
          { recentlyClosed: [], selectedId: "x", tabs: [asTab("x")] },
        ],
      ]),
    ],
    ["spare", new Map()],
  ]);
}

const moving = (neighborPages: string[] = [], pages: string[] = []) => ({
  neighborPages: neighborPages.map(page),
  pages: pages.map(page),
  tab: asTab("a"),
});

/** A tab with a page someone has used, which keeps its window. */
function withUsedPage(neighborPages: string[] = []) {
  state.usedPages = new Set(["own-page"]);
  return moving(neighborPages, ["own-page"]);
}

/** A press on the first tab, of a window with others beside it. */
function press(
  standing = moving(),
  isOnlyTab = false,
  at = { x: 200, y: 120 },
) {
  state.cursor = at;
  return startTabCarry({
    at,
    grab: { x: 100, y: 20 },
    isOffRow: isOnlyTab,
    isOnlyTab,
    moving: standing,
    pointInTab: 30,
    webContentsId: 1,
  });
}

/** The pointer moved: main reads the cursor itself, on its timer. */
function moveTo(point: { x: number; y: number }, isOffRow = true) {
  state.cursor = point;
  noteTabCarry({ ...point, isOffRow });
  vi.advanceTimersByTime(8);
}

/** Lets what waits on a window having drawn go through. */
async function settle() {
  await vi.advanceTimersByTimeAsync(500);
}

/** Lets the tab go, and everything that comes of it. */
async function letGo() {
  const end = endTabCarry({ canceled: false });
  await settle();
  return end;
}

const lastViewOf = (id: number) =>
  state.views.filter((each) => each.webContentsId === id).at(-1)?.view;
const viewKindsOf = (id: number) =>
  state.views
    .filter((each) => each.webContentsId === id)
    .map(({ view }) => view.kind);
const tabsOf = (id: string) =>
  (
    state.kept.get(id)?.get("app-tabs.v2") as { tabs: Tab[] } | undefined
  )?.tabs.map((tab) => tab.id);

beforeEach(() => {
  vi.useFakeTimers();
  state.cursor = { x: 0, y: 0 };
  state.listening = true;
  state.offScreen = false;
  state.sent = [];
  state.taken = 0;
  state.usedPages = new Set();
  state.views = [];
  for (const mock of [
    handOffGuest,
    adoptSpareWindow,
    returnSpareWindow,
    closeEmptiedWindow,
    openTabPicture,
    picture.close,
    picture.hide,
    picture.moveTo,
    picture.show,
  ]) {
    mock.mockClear();
  }
  setUp();
});

afterEach(async () => {
  await endTabCarry({ canceled: true });
  vi.useRealTimers();
  Object.defineProperty(process, "platform", { value: PLATFORM });
});

describe("a tab being dragged", () => {
  it("costs no window along its row, and shows no picture", () => {
    expect(press()).toEqual({ collapsesOffRow: true });
    moveTo({ x: 400, y: 120 }, false);

    expect(picture.show).not.toHaveBeenCalled();
    expect(tabsOf("spare")).toBeUndefined();
    expect(spareWindow.visible).toBe(false);
  });

  it("off its row, has its picture follow the pointer, with nothing else moving", () => {
    press(moving(["next-page"], ["own-page"]));
    moveTo(IN_THE_OPEN);
    expect(picture.show).toHaveBeenCalledWith(IN_THE_OPEN);

    const further = { x: 1520, y: 1510 };
    moveTo(further);
    expect(picture.moveTo).toHaveBeenLastCalledWith(further);
    expect(from.bounds).toEqual(BOUNDS);
    expect(handOffGuest).not.toHaveBeenCalled();
  });

  it("off its row, has the spare ready and out of sight for the release", () => {
    press();
    moveTo(IN_THE_OPEN);

    expect(tabsOf("spare")).toEqual(["a"]);
    expect(spareWindow.visible).toBe(true);
    expect(spareWindow.opacity).toBe(0);
    expect(lastViewOf(2)?.kind).toBe("beneath");
  });

  it("where nothing can be kept out of sight, puts up nothing until the release", () => {
    setUp({ platform: "linux" });
    press();
    moveTo(IN_THE_OPEN);

    expect(picture.show).toHaveBeenCalled();
    expect(spareWindow.visible).toBe(false);
  });
});

describe("a tab let go in the open", () => {
  it("opens fresh in a window of its own, and the window it came from stays", async () => {
    press(moving(["next-page"], ["own-page"]));
    moveTo(IN_THE_OPEN);
    const end = await letGo();

    expect(end).toEqual({ kind: "losesTab" });
    expect(from.bounds).toEqual(BOUNDS);
    expect(spareWindow.bounds).toMatchObject({ x: 1400, y: 1480 });
    expect(spareWindow.opacity).toBe(1);
    expect(spareWindow.focused).toBe(1);
    expect(adoptSpareWindow).toHaveBeenCalledWith(state.spare);
    expect(handOffGuest).toHaveBeenCalledTimes(1);
    expect(handOffGuest).toHaveBeenCalledWith("own-page", 2);
    expect(picture.close).toHaveBeenCalled();
  });

  it("keeps its window where its page has been used, and the others stay in its place", async () => {
    press(withUsedPage(["next-page"]));
    moveTo(IN_THE_OPEN);
    const end = await letGo();

    expect(end).toEqual({ kind: "keepsTab" });
    expect(tabsOf("spare")).toEqual(["b"]);
    expect(spareWindow.bounds).toEqual(BOUNDS);
    expect(adoptSpareWindow).toHaveBeenCalledWith(state.spare);
    expect(handOffGuest).toHaveBeenCalledWith("next-page", 2);
    expect(handOffGuest).not.toHaveBeenCalledWith("own-page", 2);
    expect(from.bounds).toMatchObject({ x: 1400, y: 1480 });
    expect(from.focused).toBe(1);
  });

  it("gives the window its one tab out of sight, before it comes out from under the spare", async () => {
    press(withUsedPage());
    moveTo(IN_THE_OPEN);
    let boundsWhenDrawn;
    let spareOpacityWhenDrawn;
    from.webContents.executeJavaScript = () => {
      boundsWhenDrawn ??= { ...from.bounds };
      spareOpacityWhenDrawn ??= spareWindow.opacity;
      return Promise.resolve(true);
    };
    await letGo();

    expect(tabsOf("from")).toEqual(["a"]);
    expect(state.kept.get("from")?.get("compose.v2")).toEqual([]);
    expect(boundsWhenDrawn).toEqual(BOUNDS);
    // Short of opaque, or a window under it on macOS stops drawing.
    expect(spareOpacityWhenDrawn).toBeLessThan(1);
    expect(spareOpacityWhenDrawn).toBeGreaterThan(0.99);
    expect(spareWindow.opacity).toBe(1);
    expect(viewKindsOf(1)).toEqual(["reshaping", "row"]);
    expect(picture.close).toHaveBeenCalled();
  });

  it("leaves the window of its tabs on the tab beside it as the window has them at the release", async () => {
    setUp({ tabs: ["b", "a", "c"] });
    press(withUsedPage(["c-page"]));
    moveTo(IN_THE_OPEN);
    await letGo();

    expect(state.kept.get("spare")?.get("app-tabs.v2")).toMatchObject({
      selectedId: "c",
      tabs: [asTab("b"), asTab("c")],
    });
  });

  it("goes full screen as the window it came from stands, which stays", async () => {
    from.full = true;
    press(withUsedPage());
    moveTo(IN_THE_OPEN);
    const end = await letGo();

    expect(end).toEqual({ kind: "losesTab" });
    expect(from.bounds).toEqual(BOUNDS);
    expect(spareWindow.setFullScreen).toHaveBeenCalledWith(true);
  });

  it("is ready for a release before main first looked at the pointer", async () => {
    setUp({ platform: "linux" });
    press(withUsedPage());
    expect(spareWindow.visible).toBe(false);

    state.cursor = IN_THE_OPEN;
    noteTabCarry({ ...IN_THE_OPEN, isOffRow: true });
    const end = await letGo();
    expect(end).toEqual({ kind: "keepsTab" });
    expect(spareWindow.visible).toBe(true);
  });
});

describe("a tab brought back, or the drag called off", () => {
  it("back on its row, puts its picture away, and costs nothing when let go", async () => {
    press(moving(["next-page"], ["own-page"]));
    moveTo(IN_THE_OPEN);
    moveTo({ x: 200, y: 120 }, false);
    expect(picture.hide).toHaveBeenCalled();

    expect(await letGo()).toEqual({ kind: "none" });
    expect(from.bounds).toEqual(BOUNDS);
    expect(handOffGuest).not.toHaveBeenCalled();
    expect(adoptSpareWindow).not.toHaveBeenCalled();
    expect(returnSpareWindow).toHaveBeenCalledTimes(1);
    expect(picture.close).toHaveBeenCalled();
  });

  it("on Escape, leaves everything as it was, a used page or not", async () => {
    press(withUsedPage(["next-page"]));
    moveTo(IN_THE_OPEN);

    expect(await endTabCarry({ canceled: true })).toEqual({ kind: "none" });
    expect(from.bounds).toEqual(BOUNDS);
    expect(handOffGuest).not.toHaveBeenCalled();
    expect(adoptSpareWindow).not.toHaveBeenCalled();
    expect(returnSpareWindow).toHaveBeenCalledTimes(1);
    expect(picture.close).toHaveBeenCalled();
    expect(viewKindsOf(1)).toEqual([]);
  });

  it("takes the tab back out of a strip it was held over", async () => {
    press();
    moveTo(OVER_STRIP);
    expect(lastViewOf(3)?.kind).toBe("incoming");

    await endTabCarry({ canceled: true });
    expect(lastViewOf(3)?.kind).toBe("row");
  });
});

describe("near another window's strip", () => {
  it("has that window draw the tab at the pointer, in place of its picture", () => {
    press();
    moveTo(OVER_STRIP);

    expect(lastViewOf(3)).toEqual({
      clientX: 200,
      kind: "incoming",
      pointInTab: 30,
      tab: { id: "a", pathname: "/a" },
    });
    expect(picture.hide).toHaveBeenCalled();
    expect(from.bounds).toEqual(BOUNDS);
  });

  it("follows the pointer along that strip", () => {
    press();
    moveTo(OVER_STRIP);
    moveTo({ x: 1700, y: 120 });
    expect(lastViewOf(3)).toMatchObject({ clientX: 300, kind: "incoming" });
  });

  it("holds through a small move, and comes out when pulled clear", () => {
    press();
    moveTo(OVER_STRIP);

    // 40px of strip and 24 of reach: this is 12 past the strip.
    moveTo({ x: 1600, y: 152 });
    expect(lastViewOf(3)?.kind).toBe("incoming");

    moveTo({ x: 1600, y: 300 });
    expect(lastViewOf(3)?.kind).toBe("row");
    expect(picture.show).toHaveBeenLastCalledWith({ x: 1600, y: 300 });
  });

  it("ignores a window not in sight, and a full-screen one in a Space of its own", async () => {
    other.visible = false;
    press();
    moveTo(OVER_STRIP);
    expect(lastViewOf(3)).toBeUndefined();
    await endTabCarry({ canceled: true });

    other.visible = true;
    other.full = true;
    press();
    moveTo(OVER_STRIP);
    expect(lastViewOf(3)).toBeUndefined();
  });

  it("works in a window held off screen, in an instance an agent drives", () => {
    state.offScreen = true;
    other.visible = false;
    press();
    moveTo(OVER_STRIP);
    expect(lastViewOf(3)?.kind).toBe("incoming");
  });

  it("goes to that window, which stays as it is, where the tab's page has not been used", async () => {
    press(moving([], ["own-page"]));
    moveTo(OVER_STRIP);
    placeTabCarry(3, 1);
    const end = await letGo();

    expect(end).toEqual({ kind: "losesTab" });
    expect(state.sent).toEqual([{ id: "other", index: 1, tab: asTab("a") }]);
    expect(handOffGuest).toHaveBeenCalledWith("own-page", 3);
    expect(other.focused).toBe(1);
    expect(lastViewOf(3)?.kind).toBe("row");
    expect(closeEmptiedWindow).not.toHaveBeenCalled();
    expect(from.bounds).toEqual(BOUNDS);
    expect(returnSpareWindow).toHaveBeenCalledTimes(1);
    expect(picture.close).toHaveBeenCalled();
  });

  it("takes on that window's strip where the tab's page has been used, and that window closes", async () => {
    press(withUsedPage());
    moveTo(OVER_STRIP);
    placeTabCarry(3, 0);
    const end = await letGo();

    expect(end).toEqual({ kind: "takesStrip" });
    expect(state.kept.get("from")?.get("app-tabs.v2")).toMatchObject({
      selectedId: "a",
      tabs: [asTab("a"), asTab("x")],
    });
    expect(from.bounds).toEqual(other.bounds);
    expect(closeEmptiedWindow).toHaveBeenCalledWith(other);
    expect(adoptSpareWindow).toHaveBeenCalledWith(state.spare);
    expect(tabsOf("spare")).toEqual(["b"]);
  });

  it("hears where the tab stands only from the window it is over", async () => {
    press(withUsedPage());
    moveTo(OVER_STRIP);
    placeTabCarry(3, 0);
    placeTabCarry(99, 1);
    await letGo();

    expect(tabsOf("from")).toEqual(["a", "x"]);
  });

  it("opens a window of its own when that window's page cannot hear yet", async () => {
    state.listening = false;
    press();
    moveTo(OVER_STRIP);
    const end = await letGo();

    expect(end).toEqual({ kind: "losesTab" });
    expect(adoptSpareWindow).toHaveBeenCalledWith(state.spare);
    expect(lastViewOf(3)?.kind).toBe("row");
    expect(closeEmptiedWindow).not.toHaveBeenCalled();
  });
});

describe("a window's only tab", () => {
  it("takes its window with it, with no picture and no spare", () => {
    expect(press(moving(), true)).toEqual({ collapsesOffRow: false });
    moveTo(IN_THE_OPEN);

    expect(openTabPicture).not.toHaveBeenCalled();
    expect(state.taken).toBe(0);
    expect(from.bounds).toMatchObject({ x: 1400, y: 1480 });
    moveTo({ x: 1500, y: 1600 });
    expect(from.bounds).toMatchObject({ x: 1400, y: 1580 });
  });

  it("does not dock a window onto the strip its press was already over", () => {
    press(moving(), true, OVER_STRIP);
    moveTo({ x: 1610, y: 122 });
    expect(lastViewOf(3)).toBeUndefined();

    moveTo({ x: 1610, y: 500 });
    moveTo(OVER_STRIP);
    expect(lastViewOf(3)?.kind).toBe("incoming");
  });

  it("clears out of the way of a strip it is over, and comes back off it", () => {
    press(moving(), true);
    moveTo(OVER_STRIP);
    expect(from.opacity).toBe(0);

    moveTo(IN_THE_OPEN);
    expect(from.opacity).toBe(1);
  });

  it("goes to that window, whose floats take its own, and its window closes", async () => {
    state.kept.get("from")?.set("compose.v2", [{ chatId: "c" }]);
    press(moving(), true);
    moveTo(OVER_STRIP);
    const end = await letGo();

    expect(end).toEqual({ kind: "closes" });
    expect(state.kept.get("other")?.get("compose.v2")).toEqual([
      { chatId: "c" },
    ]);
    expect(closeEmptiedWindow).toHaveBeenCalledWith(from);
  });

  it("with a used page, keeps its window and takes on that window's strip", async () => {
    press(withUsedPage(), true);
    moveTo(OVER_STRIP);
    const end = await letGo();

    expect(end).toEqual({ kind: "takesStrip" });
    expect(from.opacity).toBe(1);
    expect(from.bounds).toEqual(other.bounds);
    expect(closeEmptiedWindow).toHaveBeenCalledWith(other);
  });

  it("still lands in the strip when that window's page cannot hear yet", async () => {
    state.listening = false;
    press(moving(), true);
    moveTo(OVER_STRIP);

    expect(await letGo()).toEqual({ kind: "takesStrip" });
    expect(closeEmptiedWindow).toHaveBeenCalledWith(other);
  });

  it("puts its window back on Escape", async () => {
    press(moving(), true);
    moveTo(IN_THE_OPEN);
    await endTabCarry({ canceled: true });

    expect(from.bounds).toEqual(BOUNDS);
    expect(from.opacity).toBe(1);
  });
});

describe("a tab moved from a menu", () => {
  const moveTab = (standing: ReturnType<typeof moving>, to: unknown) => {
    const moved = moveTabNow({
      isOnlyTab: false,
      moving: standing,
      to: to as Parameters<typeof moveTabNow>[0]["to"],
      webContentsId: 1,
    });
    return settle().then(() => moved);
  };

  it("shows no picture", async () => {
    await moveTab(moving(), { kind: "new" });
    expect(openTabPicture).not.toHaveBeenCalled();
  });

  it("to a new window opens fresh there, and its window stays, as a drag let go in the open", async () => {
    await expect(moveTab(moving(), { kind: "new" })).resolves.toEqual({
      kind: "losesTab",
    });
    expect(from.bounds).toEqual(BOUNDS);
    expect(spareWindow.bounds).toMatchObject({ x: 126, y: 126 });
    expect(tabsOf("spare")).toEqual(["a"]);
  });

  it("with a used page keeps its window, as a drag let go in the open", async () => {
    await expect(moveTab(withUsedPage(), { kind: "new" })).resolves.toEqual({
      kind: "keepsTab",
    });
    expect(from.bounds).toMatchObject({ x: 126, y: 126 });
    expect(tabsOf("spare")).toEqual(["b"]);
    expect(tabsOf("from")).toEqual(["a"]);
  });

  it("to another window goes the way a drag let go over its strip does", async () => {
    await expect(
      moveTab(moving(), { id: "other", kind: "window" }),
    ).resolves.toEqual({ kind: "losesTab" });
    expect(state.sent).toEqual([
      { id: "other", index: undefined, tab: asTab("a") },
    ]);
  });

  it("with a used page takes on that window's strip, with the tab at its end", async () => {
    await expect(
      moveTab(withUsedPage(), { id: "other", kind: "window" }),
    ).resolves.toEqual({ kind: "takesStrip" });
    expect(tabsOf("from")).toEqual(["x", "a"]);
    expect(closeEmptiedWindow).toHaveBeenCalledWith(other);
  });

  it("does nothing where that window has gone", async () => {
    await expect(
      moveTab(moving(), { id: "gone", kind: "window" }),
    ).resolves.toEqual({ kind: "none" });
    expect(returnSpareWindow).toHaveBeenCalledTimes(1);
  });
});

describe("a window gone under the drag", () => {
  it("puts things back when the spare crashed", () => {
    press();
    moveTo(IN_THE_OPEN);
    spareWindow.destroyed = true;

    vi.advanceTimersByTime(8);
    expect(returnSpareWindow).toHaveBeenCalledTimes(1);
    expect(picture.close).toHaveBeenCalled();
  });

  it("ends the drag with nothing changing hands", async () => {
    press();
    moveTo(IN_THE_OPEN);
    from.destroyed = true;

    expect(await letGo()).toEqual({ kind: "none" });
    expect(adoptSpareWindow).not.toHaveBeenCalled();
  });
});
