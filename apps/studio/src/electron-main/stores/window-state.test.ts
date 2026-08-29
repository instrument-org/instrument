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

describe("getWindowState", () => {
  it("restores a saved size that GNOME leaves alone", () => {
    stored = {
      bounds: { height: 576, width: 1085, x: 66, y: 95 },
      isMaximized: false,
    };
    setPlatform("linux");

    expect(windowState.getWindowState().bounds).toMatchInlineSnapshot(`
      {
        "height": 576,
        "width": 1085,
        "x": 66,
        "y": 95,
      }
    `);
  });

  it("shrinks a saved size GNOME would auto-maximize, keeping its shape", () => {
    stored = { bounds: almostMaximized, isMaximized: false };
    setPlatform("linux");

    expect(windowState.getWindowState().bounds).toMatchInlineSnapshot(`
      {
        "height": 688,
        "width": 1082,
        "x": 90,
        "y": 60,
      }
    `);
  });

  it("cannot see the line while the display reports no struts", () => {
    stored = { bounds: almostMaximized, isMaximized: false };
    currentDisplay = waylandDisplay;
    setPlatform("linux");

    expect(windowState.getWindowState().bounds).toMatchInlineSnapshot(`
      {
        "height": 690,
        "width": 1085,
        "x": 90,
        "y": 60,
      }
    `);
  });

  it("sees it once a maximized window has measured the work area", () => {
    stored = { bounds: almostMaximized, isMaximized: false };
    currentDisplay = waylandDisplay;
    setPlatform("linux");

    windowState.rememberWorkAreaFromMaximized(maximizedBounds);

    expect(windowState.getWindowState().bounds).toMatchInlineSnapshot(`
      {
        "height": 688,
        "width": 1082,
        "x": 90,
        "y": 60,
      }
    `);
  });

  it("leaves an oversized saved size alone off Linux", () => {
    stored = { bounds: almostMaximized, isMaximized: false };
    setPlatform("darwin");

    expect(windowState.getWindowState().bounds).toMatchInlineSnapshot(`
      {
        "height": 690,
        "width": 1085,
        "x": 90,
        "y": 60,
      }
    `);
  });
});
