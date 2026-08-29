import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getWindowState } from "./window-state";

// A 1280x800 screen with GNOME's top bar and dock taken out of the work area,
// matching the display the auto-maximize behavior was reproduced on.
const display = {
  bounds: { height: 800, width: 1280, x: 0, y: 0 },
  workArea: { height: 768, width: 1214, x: 66, y: 32 },
};

let stored: Record<string, unknown> = {};

vi.mock("electron", () => ({
  screen: {
    getAllDisplays: () => [display],
    getDisplayMatching: () => display,
    getPrimaryDisplay: () => display,
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

beforeEach(() => {
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

    expect(getWindowState().bounds).toMatchInlineSnapshot(`
      {
        "height": 576,
        "width": 1085,
        "x": 66,
        "y": 95,
      }
    `);
  });

  it("shrinks a saved size GNOME would auto-maximize, keeping its shape", () => {
    stored = {
      bounds: { height: 690, width: 1085, x: 90, y: 60 },
      isMaximized: false,
    };
    setPlatform("linux");

    expect(getWindowState().bounds).toMatchInlineSnapshot(`
      {
        "height": 688,
        "width": 1082,
        "x": 90,
        "y": 60,
      }
    `);
  });

  it("leaves an oversized saved size alone off Linux", () => {
    stored = {
      bounds: { height: 690, width: 1085, x: 90, y: 60 },
      isMaximized: false,
    };
    setPlatform("darwin");

    expect(getWindowState().bounds).toMatchInlineSnapshot(`
      {
        "height": 690,
        "width": 1085,
        "x": 90,
        "y": 60,
      }
    `);
  });
});
