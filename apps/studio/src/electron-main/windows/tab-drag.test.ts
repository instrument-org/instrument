import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: {},
  nativeTheme: {},
  screen: {},
  webContents: {},
}));
vi.mock("@/electron-main/rpc/publisher", () => ({ publisher: {} }));
vi.mock("@/electron-main/stores/workspace/window-state", () => ({}));
vi.mock("@/electron-main/windows/app-window", () => ({}));
vi.mock("@/electron-main/windows/on-screen", () => ({}));

const { carryDestination, placeOnWindow } = await import("./tab-drag");

const BAND = 40;
const left = { bounds: { height: 500, width: 500, x: 0, y: 0 } };
const right = { bounds: { height: 500, width: 500, x: 600, y: 0 } };
const over = { bounds: { height: 500, width: 500, x: 100, y: 100 } };

describe("where a window puts a point", () => {
  it.each([
    [{ x: 10, y: 10 }, "band"],
    [{ x: 10, y: 39 }, "band"],
    [{ x: 10, y: 40 }, "body"],
    [{ x: 499, y: 499 }, "body"],
    [{ x: 500, y: 10 }, "off"],
    [{ x: 10, y: -1 }, "off"],
  ] as const)("%o is %s", (point, place) => {
    expect(placeOnWindow(left.bounds, point, BAND)).toBe(place);
  });
});

describe("where a tab let go lands", () => {
  const land = (
    point: undefined | { x: number; y: number },
    windows = [left, right],
    { canceled = false, from = left } = {},
  ) => carryDestination({ bandHeight: BAND, canceled, from, point, windows });

  it("joins the strip of another window", () => {
    expect(land({ x: 700, y: 20 })).toEqual({ place: "band", window: right });
  });

  it("stays put over its own strip", () => {
    expect(land({ x: 100, y: 20 })).toEqual({ place: "none" });
  });

  it("is a window of its own over nothing", () => {
    expect(land({ x: 550, y: 300 })).toEqual({ place: "new" });
  });

  it("is a window of its own over another window's page", () => {
    expect(land({ x: 700, y: 300 })).toEqual({ place: "new" });
  });

  it("is a window of its own over its own window's page", () => {
    expect(land({ x: 100, y: 300 })).toEqual({ place: "new" });
  });

  it("cannot reach a strip another window covers", () => {
    expect(land({ x: 150, y: 120 }, [over, left])).toEqual({
      place: "band",
      window: over,
    });
    expect(
      land({ x: 150, y: 20 }, [over, left, right], { from: right }),
    ).toEqual({ place: "band", window: left });
    expect(
      land({ x: 150, y: 200 }, [over, left, right], { from: right }),
    ).toEqual({ place: "new" });
  });

  it("stays put when canceled or never moved", () => {
    expect(land({ x: 700, y: 20 }, undefined, { canceled: true })).toEqual({
      place: "none",
    });
    expect(land(undefined)).toEqual({ place: "none" });
  });
});
