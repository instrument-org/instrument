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
    setBounds: (next: typeof bounds) => {
      window.bounds = { ...next };
    },
    setFullScreen: vi.fn(),
    setFullScreenable: vi.fn(),
    setIgnoreMouseEvents: vi.fn(),
    setOpacity: () => {
      if (window.destroyed) {
        throw new Error("Object has been destroyed");
      }
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
  usedHosts: new Set<number>(),
  usedPages: new Set<string>(),
  views: [] as { view: { kind: string }; webContentsId: number }[],
  windows: new Map<number, unknown>(),
}));

const handOffGuest = vi.hoisted(() => vi.fn());
const adoptSpareWindow = vi.hoisted(() => vi.fn());
const returnSpareWindow = vi.hoisted(() => vi.fn());
const closeEmptiedWindow = vi.hoisted(() => vi.fn());
const zoom = vi.hoisted(() => ({ value: 1 }));

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
    hasUsedPage: (id: number) => state.usedHosts.has(id),
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

const lastViewOf = (id: number) =>
  state.views.filter((each) => each.webContentsId === id).at(-1)?.view.kind;
const spareTabs = () =>
  (
    state.kept.get("spare")?.get("app-tabs.v2") as { tabs: Tab[] } | undefined
  )?.tabs.map((tab) => tab.id);

beforeEach(() => {
  vi.useFakeTimers();
  state.cursor = { x: 0, y: 0 };
  state.listening = true;
  state.offScreen = false;
  state.sent = [];
  state.taken = 0;
  state.usedHosts = new Set();
  state.usedPages = new Set();
  state.views = [];
  handOffGuest.mockClear();
  adoptSpareWindow.mockClear();
  returnSpareWindow.mockClear();
  closeEmptiedWindow.mockClear();
  setUp();
});

afterEach(() => {
  endTabCarry({ canceled: true });
  vi.useRealTimers();
  Object.defineProperty(process, "platform", { value: PLATFORM });
});

describe("a tab pulled into the open", () => {
  it("keeps its window, and the others go to the spare, which is a window from then on", async () => {
    press(moving(["next-page"]));
    moveTo(IN_THE_OPEN);
    await settle();
    expect(lastViewOf(1)).toBe("free");
    expect(spareTabs()).toEqual(["b"]);

    expect(endTabCarry({ canceled: false })).toEqual({ kind: "keepsTab" });
    expect(adoptSpareWindow).toHaveBeenCalledWith(state.spare);
    expect(handOffGuest).toHaveBeenCalledWith("next-page", 2);
    expect(from.bounds).toMatchObject({ x: 1400, y: 1480 });
    expect(from.focused).toBe(1);
  });

  it("brings up the tab beside it as the window has them at the release", async () => {
    setUp({ tabs: ["b", "a", "c"] });
    press(moving(["b-page"]));
    moveTo(IN_THE_OPEN);
    await settle();
    endTabCarry({ canceled: false });

    expect(state.kept.get("spare")?.get("app-tabs.v2")).toMatchObject({
      selectedId: "c",
      tabs: [asTab("b"), asTab("c")],
    });
  });

  it("shows the spare even when let go before main first looked at the pointer", () => {
    setUp({ platform: "linux" });
    press();
    expect(spareWindow.visible).toBe(false);

    state.cursor = IN_THE_OPEN;
    noteTabCarry({ ...IN_THE_OPEN, isOffRow: true });
    expect(endTabCarry({ canceled: false })).toEqual({ kind: "keepsTab" });
    expect(spareWindow.visible).toBe(true);
  });
});

describe("a tab brought back, or the drag called off", () => {
  it.each([
    ["back on its row", () => moveTo({ x: 200, y: 120 }, false)],
    ["Escape", () => endTabCarry({ canceled: true })],
  ])("puts the window back and the spare away: %s", async (_case, undo) => {
    press();
    moveTo(IN_THE_OPEN);
    await settle();
    undo();
    await settle();
    endTabCarry({ canceled: false });

    expect(from.bounds).toEqual(BOUNDS);
    expect(adoptSpareWindow).not.toHaveBeenCalled();
    expect(returnSpareWindow).toHaveBeenCalledTimes(1);
    expect(lastViewOf(1)).toBe("row");
  });

  it("leaves a used page next door where it is, so nothing is lost by undoing", async () => {
    state.usedPages = new Set(["next-page"]);
    press(moving(["next-page"]));
    moveTo(IN_THE_OPEN);
    await settle();
    expect(handOffGuest).not.toHaveBeenCalled();

    endTabCarry({ canceled: true });
    expect(handOffGuest).not.toHaveBeenCalled();
  });

  it("hands an unused page next door over and back", async () => {
    press(moving(["next-page"]));
    moveTo(IN_THE_OPEN);
    await settle();
    expect(handOffGuest).toHaveBeenLastCalledWith("next-page", 2);

    endTabCarry({ canceled: true });
    expect(handOffGuest).toHaveBeenLastCalledWith("next-page", 1);
  });

  it("leaves a used page of the tab itself in place where the tab is what goes, as from full screen", async () => {
    setUp();
    from.full = true;
    state.usedPages = new Set(["own-page"]);
    press(moving([], ["own-page"]));
    moveTo(IN_THE_OPEN);
    await settle();
    expect(handOffGuest).not.toHaveBeenCalled();

    endTabCarry({ canceled: true });
    expect(handOffGuest).not.toHaveBeenCalled();
  });
});

describe("near another window's strip", () => {
  const OVER_STRIP = { x: 1600, y: 120 };

  it("docks once, holds through a small move, and comes out when pulled clear", async () => {
    press();
    moveTo(OVER_STRIP);
    await settle();
    expect(lastViewOf(1)).toBe("docked");
    expect(from.bounds).toEqual(other.bounds);

    // 40px of strip and 24 of reach: this is 12 past the strip.
    moveTo({ x: 1600, y: 152 });
    expect(lastViewOf(1)).toBe("docked");

    moveTo({ x: 1600, y: 300 });
    await settle();
    expect(lastViewOf(1)).toBe("free");
  });

  it("does not dock a window onto the strip its press was already over", async () => {
    press(moving(), true, OVER_STRIP);
    moveTo({ x: 1610, y: 122 });
    await settle();
    expect(lastViewOf(1)).toBe("free");

    moveTo({ x: 1610, y: 500 });
    await settle();
    moveTo(OVER_STRIP);
    await settle();
    expect(lastViewOf(1)).toBe("docked");
  });

  it("ignores a window not in sight, and a full-screen one in a Space of its own", async () => {
    other.visible = false;
    press();
    moveTo(OVER_STRIP);
    await settle();
    expect(lastViewOf(1)).toBe("free");
    endTabCarry({ canceled: true });

    other.visible = true;
    other.full = true;
    press();
    moveTo(OVER_STRIP);
    await settle();
    expect(lastViewOf(1)).toBe("free");
  });

  it("docks in a window held off screen, in an instance an agent drives", async () => {
    state.offScreen = true;
    other.visible = false;
    press();
    moveTo(OVER_STRIP);
    await settle();
    expect(lastViewOf(1)).toBe("docked");
  });

  it("lands where the tab was drawn, when it went straight from one strip to another", async () => {
    const beside = fakeWindow(4, "beside", { ...BOUNDS, x: 2600 });
    state.appWindows = [from, other, beside];
    state.kept.set(
      "beside",
      new Map<string, unknown>([
        [
          "app-tabs.v2",
          {
            recentlyClosed: [],
            selectedId: "y",
            tabs: [asTab("y"), asTab("z")],
          },
        ],
      ]),
    );
    press();
    moveTo(OVER_STRIP);
    await settle();
    placeTabCarry(1);
    // Its window has no cause to say so again: the place along the strip is the same.
    moveTo({ x: 2700, y: 120 });
    await settle();
    expect(lastViewOf(1)).toBe("docked");

    expect(endTabCarry({ canceled: false })).toMatchObject({
      kind: "takesStrip",
      model: { tabs: [asTab("y"), asTab("a"), asTab("z")] },
    });
  });

  it("takes on that window's strip when let go, and that window closes", async () => {
    press();
    moveTo(OVER_STRIP);
    await settle();
    placeTabCarry(0);

    expect(endTabCarry({ canceled: false })).toMatchObject({
      kind: "takesStrip",
      model: { selectedId: "a", tabs: [asTab("a"), asTab("x")] },
    });
    expect(closeEmptiedWindow).toHaveBeenCalledWith(other);
    expect(adoptSpareWindow).toHaveBeenCalledWith(state.spare);
  });

  it("goes to that window instead when only it has a used page", async () => {
    state.usedHosts = new Set([3]);
    press();
    moveTo(OVER_STRIP);
    await settle();
    placeTabCarry(1);

    expect(endTabCarry({ canceled: false })).toEqual({ kind: "closes" });
    expect(state.sent).toEqual([{ id: "other", index: 1, tab: asTab("a") }]);
    await settle();
    expect(closeEmptiedWindow).toHaveBeenCalledWith(from);
  });

  it("still lands in the strip when that window's page cannot hear yet", async () => {
    state.usedHosts = new Set([3]);
    state.listening = false;
    press();
    moveTo(OVER_STRIP);
    await settle();

    expect(endTabCarry({ canceled: false })).toMatchObject({
      kind: "takesStrip",
    });
    expect(closeEmptiedWindow).toHaveBeenCalledWith(other);
  });
});

describe("a tab moved from a menu", () => {
  it("to a new window goes the way a drag let go in the open does", async () => {
    const moved = moveTabNow({
      isOnlyTab: false,
      moving: moving(["next-page"]),
      to: { kind: "new" },
      webContentsId: 1,
    });
    await settle();

    await expect(moved).resolves.toEqual({ kind: "keepsTab" });
    expect(from.bounds).toMatchObject({ x: 126, y: 126 });
    expect(spareTabs()).toEqual(["b"]);
    expect(adoptSpareWindow).toHaveBeenCalledWith(state.spare);
  });

  it("to another window goes the way a drag let go over its strip does", async () => {
    const moved = moveTabNow({
      isOnlyTab: false,
      moving: moving(),
      to: { id: "other", kind: "window" },
      webContentsId: 1,
    });
    await settle();

    await expect(moved).resolves.toMatchObject({
      kind: "takesStrip",
      model: { tabs: [asTab("x"), asTab("a")] },
    });
    expect(closeEmptiedWindow).toHaveBeenCalledWith(other);
  });

  it("does nothing where that window has gone", async () => {
    await expect(
      moveTabNow({
        isOnlyTab: false,
        moving: moving(),
        to: { id: "gone", kind: "window" },
        webContentsId: 1,
      }),
    ).resolves.toEqual({ kind: "none" });
    expect(returnSpareWindow).toHaveBeenCalledTimes(1);
  });
});

describe("a window gone under the drag", () => {
  it("puts things back when the spare it carried crashed", async () => {
    state.usedHosts = new Set([1]);
    press();
    moveTo(IN_THE_OPEN);
    await settle();
    expect(state.spare).not.toBeNull();
    spareWindow.destroyed = true;

    vi.advanceTimersByTime(8);
    expect(lastViewOf(1)).toBe("row");
    expect(returnSpareWindow).toHaveBeenCalledTimes(1);
  });

  it("ends the drag with nothing changing hands", async () => {
    press();
    moveTo(IN_THE_OPEN);
    await settle();
    from.destroyed = true;

    expect(endTabCarry({ canceled: false })).toEqual({ kind: "none" });
    expect(adoptSpareWindow).not.toHaveBeenCalled();
  });
});
