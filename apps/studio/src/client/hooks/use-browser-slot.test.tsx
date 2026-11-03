import { render } from "@testing-library/react";
import { browserTargetOf, StoreId } from "@instrument-org/workspace/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { showOverSlot } from "@/client/lib/browser-pool";

import { useBrowserSlot } from "./use-browser-slot";

vi.mock("@/client/lib/browser-pool", () => ({
  setPaintHost: vi.fn(),
  showOverSlot: vi.fn(),
}));
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    browser: { setEmulatedDevice: { call: vi.fn(() => Promise.resolve()) } },
  },
}));

const targetId = browserTargetOf(StoreId.newTabId());

function Slot() {
  const ref = useBrowserSlot({
    active: true,
    hasLoadError: false,
    isVisible: true,
    targetId,
  });
  return <div data-testid="slot" ref={ref} />;
}

let frames: FrameRequestCallback[] = [];
const runFrames = (count: number) => {
  for (let frame = 0; frame < count; frame += 1) {
    const running = frames;
    frames = [];
    for (const callback of running) {
      callback(0);
    }
  }
};
const lastShownX = () => vi.mocked(showOverSlot).mock.lastCall?.[1].x;

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect() {}
      observe() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("follows a slide that begins a few frames after the guest is shown", () => {
  let x = 1233;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(x, 0, 855, 752),
  );
  render(<Slot />);
  expect(lastShownX()).toBe(1233);

  // The transition has been set off, and has not started moving yet.
  runFrames(4);
  x = 900;
  runFrames(1);
  expect(lastShownX()).toBe(900);
  x = 377;
  runFrames(1);
  expect(lastShownX()).toBe(377);
});

it("stops looking once the slot has settled, telling the pool only of moves", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(377, 0, 855, 752),
  );
  render(<Slot />);
  runFrames(100);
  expect(frames).toHaveLength(0);
  expect(showOverSlot).toHaveBeenCalledTimes(1);
});
