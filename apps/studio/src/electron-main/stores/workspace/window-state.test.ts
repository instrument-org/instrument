import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as WindowStateModule from "./window-state";

// The 1280x800 screen the auto-maximize behavior was reproduced on. Under X11
// the display reports GNOME's top bar and dock as struts; under Wayland the
// client is never told about them, so the work area comes back as the whole
// output even though the compositor still keeps that space for itself.
const x11Display = {
  bounds: { height: 800, width: 1280, x: 0, y: 0 },
  id: 1,
  workArea: { height: 768, width: 1214, x: 66, y: 32 },
};
const waylandDisplay = {
  bounds: { height: 800, width: 1280, x: 0, y: 0 },
  id: 1,
  workArea: { height: 800, width: 1280, x: 0, y: 0 },
};

// Just over GNOME's line for the real 1214x768 work area: 748,650 against
// 745,881. Under Wayland it is under the line the display appears to draw.
const almostMaximized = { height: 690, width: 1085, x: 90, y: 60 };
const maximizedBounds = { height: 768, width: 1214, x: 66, y: 32 };

let currentDisplay = x11Display;
let stored: Record<string, unknown> = {};

vi.mock("electron", () => ({
  screen: {
    getAllDisplays: () => [currentDisplay],
    getDisplayMatching: () => currentDisplay,
    getPrimaryDisplay: () => currentDisplay,
  },
}));

vi.mock("@/electron-main/lib/get-workspace-folder", () => ({
  workspaceWindowDir: () => "/user-data/machine/default/window",
}));

// The zoom the kept state holds is not under test, and the real module
// brings the whole workspace package with it, which each test imports again.
vi.mock("./kept-state", () => ({ getKeptState: () => undefined }));

vi.mock("electron-store", () => ({
  default: class {
    get store() {
      return stored;
    }
    get(key: string) {
      return stored[key];
    }
    set(value: Record<string, unknown>) {
      Object.assign(stored, value);
    }
  },
}));

const setPlatform = (platform: NodeJS.Platform) => {
  Object.defineProperty(process, "platform", {
    configurable: true,
    value: platform,
  });
};

const originalPlatform = process.platform;

// Work areas learned from a maximized window live in module scope, so each test
// gets its own copy of the module rather than the previous test's memory.
let windowState: typeof WindowStateModule;

beforeEach(async () => {
  vi.resetModules();
  windowState = await import("./window-state");
  currentDisplay = x11Display;
  stored = {};
});

afterEach(() => {
  setPlatform(originalPlatform);
});

/** What the store holds once one window has been sized. */
const savedFor = (name: string, bounds: typeof almostMaximized) => ({
  windows: { [name]: { bounds, isMaximized: false } },
});

describe("getWindowState", () => {
  const size = { height: 900, width: 1400 };

  it("restores a saved size that GNOME leaves alone", () => {
    stored = savedFor("app", { height: 576, width: 1085, x: 66, y: 95 });
    setPlatform("linux");

    expect(windowState.getWindowState("app", size).bounds)
      .toMatchInlineSnapshot(`
      {
        "height": 576,
        "width": 1085,
        "x": 66,
        "y": 95,
      }
    `);
  });

  it("shrinks a saved size GNOME would auto-maximize, keeping its shape", () => {
    stored = savedFor("app", almostMaximized);
    setPlatform("linux");

    expect(windowState.getWindowState("app", size).bounds)
      .toMatchInlineSnapshot(`
      {
        "height": 688,
        "width": 1082,
        "x": 90,
        "y": 60,
      }
    `);
  });

  it("cannot see the line while the display reports no struts", () => {
    stored = savedFor("app", almostMaximized);
    currentDisplay = waylandDisplay;
    setPlatform("linux");

    expect(windowState.getWindowState("app", size).bounds)
      .toMatchInlineSnapshot(`
      {
        "height": 690,
        "width": 1085,
        "x": 90,
        "y": 60,
      }
    `);
  });

  it("sees it once a maximized window has measured the work area", () => {
    stored = savedFor("app", almostMaximized);
    currentDisplay = waylandDisplay;
    setPlatform("linux");

    windowState.rememberWorkAreaFromMaximized(maximizedBounds);

    expect(windowState.getWindowState("app", size).bounds)
      .toMatchInlineSnapshot(`
      {
        "height": 688,
        "width": 1082,
        "x": 90,
        "y": 60,
      }
    `);
  });

  it("leaves an oversized saved size alone off Linux", () => {
    stored = savedFor("app", almostMaximized);
    setPlatform("darwin");

    expect(windowState.getWindowState("app", size).bounds)
      .toMatchInlineSnapshot(`
      {
        "height": 690,
        "width": 1085,
        "x": 90,
        "y": 60,
      }
    `);
  });

  // A window nobody has sized yet opens at the shape it was written for,
  // rather than at one size shared by every window in the app.
  it("opens an unsized window at the shape it asks for", () => {
    setPlatform("darwin");

    expect(
      windowState.getWindowState("app", { height: 600, width: 900 }).bounds,
    ).toMatchInlineSnapshot(`
      {
        "height": 600,
        "width": 900,
        "x": 190,
        "y": 100,
      }
    `);
  });
});

describe("which windows come back", () => {
  it("is the one window of a build that had only one", () => {
    stored = { windows: { app: { bounds: almostMaximized } } };
    expect(windowState.rememberedWindowIds("app")).toEqual({
      closed: [],
      open: ["app"],
    });
  });

  it("is none on a first launch", () => {
    stored = {};
    expect(windowState.rememberedWindowIds("app").open).toEqual([]);
  });

  it("keeps the window last in front at the end", () => {
    stored = {};
    windowState.rememberWindowInFront("a");
    windowState.rememberWindowInFront("b");
    windowState.rememberWindowInFront("a");
    expect(windowState.rememberedWindowIds("app").open).toEqual(["b", "a"]);
  });

  it("moves one closed to what can come back, newest first, and takes it back as it opens", () => {
    stored = {};
    windowState.rememberWindowInFront("a");
    windowState.rememberWindowInFront("b");
    windowState.rememberWindowClosed("a");
    windowState.rememberWindowClosed("b");
    expect(windowState.rememberedWindowIds("app")).toEqual({
      closed: ["b", "a"],
      open: [],
    });
    windowState.rememberWindowInFront("b");
    expect(windowState.rememberedWindowIds("app")).toEqual({
      closed: ["a"],
      open: ["b"],
    });
  });

  it("answers those that can no longer come back, and forgets where they were", () => {
    stored = { windows: { w0: { bounds: almostMaximized } } };
    let gone: string[] = [];
    for (let index = 0; index < 11; index += 1) {
      gone = windowState.rememberWindowClosed(`w${index.toString()}`);
    }
    expect(gone).toEqual(["w0"]);
    expect(windowState.hasWindowState("w0")).toBe(false);
  });

  it("remembers when a window closed until it opens again", () => {
    stored = { closedIds: ["old"] };
    vi.spyOn(Date, "now").mockReturnValue(1000);
    windowState.rememberWindowClosed("a");
    expect(windowState.windowClosedAt("a")).toBe(1000);
    expect(windowState.windowClosedAt("old")).toBe(0);
    windowState.rememberWindowInFront("a");
    expect(windowState.windowClosedAt("a")).toBe(0);
    vi.restoreAllMocks();
  });

  it("forgets a window altogether", () => {
    stored = { windows: { a: { bounds: almostMaximized } } };
    windowState.rememberWindowInFront("a");
    windowState.forgetWindow("a");
    expect(windowState.rememberedWindowIds("app")).toEqual({
      closed: [],
      open: [],
    });
    expect(windowState.hasWindowState("a")).toBe(false);
  });
});

describe("a window kept on screen", () => {
  it.each([
    [
      { height: 500, width: 500, x: 2000, y: 2000 },
      { height: 500, width: 500, x: 780, y: 300 },
    ],
    [
      { height: 500, width: 500, x: -50, y: -50 },
      { height: 500, width: 500, x: 66, y: 32 },
    ],
    [
      { height: 9000, width: 9000, x: 100, y: 100 },
      { height: 768, width: 1214, x: 66, y: 32 },
    ],
  ])("%o goes to %o", (bounds, want) => {
    currentDisplay = x11Display;
    expect(windowState.keepBoundsOnScreen(bounds)).toEqual(want);
  });
});
