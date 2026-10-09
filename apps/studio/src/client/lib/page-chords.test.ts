import {
  type BrowserTargetId,
  encodeBrowserTargetId,
  StoreId,
  TaskIdSchema,
} from "@instrument-org/workspace/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { type PageChord, pageForChord, runPageChord } from "./page-chords";

const { foregroundBrowser, getGuest, pageHoldingKeyboard, stepPage } =
  vi.hoisted(() => ({
    foregroundBrowser: vi.fn(),
    getGuest: vi.fn(),
    pageHoldingKeyboard: vi.fn(),
    stepPage: vi.fn(),
  }));

vi.mock("@/client/lib/browser-pool", () => ({
  getGuest,
  pageHoldingKeyboard,
  stepPage,
}));
vi.mock("@/client/lib/foreground-browser-registry", () => ({
  foregroundBrowser,
}));

const TASK = TaskIdSchema.parse("page-chords");
const TYPED_IN = encodeBrowserTargetId(TASK, StoreId.newSessionId());
const LOOKED_AT = encodeBrowserTargetId(TASK, StoreId.newSessionId());

function where({
  keyboard,
  looking,
}: {
  keyboard: BrowserTargetId | null;
  looking: BrowserTargetId | null;
}) {
  pageHoldingKeyboard.mockReturnValue(keyboard);
  foregroundBrowser.mockReturnValue(
    looking ? { targetId: looking } : null,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pageForChord", () => {
  it.each<[PageChord, BrowserTargetId | null, BrowserTargetId | null]>([
    // [chord, the page meant while one page holds the keyboard and another is looked at, the page meant with the caret in the window]
    ["back", TYPED_IN, null],
    ["forward", TYPED_IN, null],
    ["zoomIn", TYPED_IN, null],
    ["zoomOut", TYPED_IN, null],
    ["zoomReset", TYPED_IN, null],
    ["reloadPage", TYPED_IN, LOOKED_AT],
  ])(
    "%s means %s, and %s with the caret in the window",
    (chord, typing, caretInWindow) => {
      where({ keyboard: TYPED_IN, looking: LOOKED_AT });
      expect(pageForChord(chord)).toBe(typing);
      where({ keyboard: null, looking: LOOKED_AT });
      expect(pageForChord(chord)).toBe(caretInWindow);
    },
  );

  it("means no page when none is on screen", () => {
    where({ keyboard: null, looking: null });
    for (const chord of [
      "back",
      "reloadPage",
      "zoomIn",
    ] as const) {
      expect(pageForChord(chord)).toBeNull();
    }
  });
});

describe("runPageChord", () => {
  it("steps the page holding the keyboard, as its surface walks it", () => {
    where({ keyboard: TYPED_IN, looking: null });
    expect(runPageChord("back")).toBe(true);
    expect(stepPage).toHaveBeenCalledWith(TYPED_IN, "back");
  });

  it("zooms the page from its own zoom, and leaves the window's alone", () => {
    const setZoom = vi.fn();
    getGuest.mockReturnValue({ setZoom, zoom: () => 1 });
    where({ keyboard: TYPED_IN, looking: null });
    expect(runPageChord("zoomIn")).toBe(true);
    expect(setZoom).toHaveBeenCalledWith(expect.any(Number));
    expect(setZoom.mock.calls[0]?.[0]).toBeGreaterThan(1);
    expect(runPageChord("zoomReset")).toBe(true);
    expect(setZoom).toHaveBeenLastCalledWith(1);
  });

  it("reloads the page looked at when the caret is in the window", () => {
    const reload = vi.fn();
    getGuest.mockReturnValue({ reload });
    where({ keyboard: null, looking: LOOKED_AT });
    expect(runPageChord("reloadPage")).toBe(true);
    expect(getGuest).toHaveBeenCalledWith(LOOKED_AT);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("leaves a chord to the window when it means no page, or one not ready", () => {
    where({ keyboard: null, looking: null });
    expect(runPageChord("zoomIn")).toBe(false);
    where({ keyboard: TYPED_IN, looking: null });
    getGuest.mockReturnValue(null);
    expect(runPageChord("zoomIn")).toBe(false);
    expect(runPageChord("reloadPage")).toBe(false);
  });
});
