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

const lastShownX = () => vi.mocked(showOverSlot).mock.lastCall?.[1].x;

// What the slot's position observer sees, sent to the one watching now: it
// is made again each time the slot moves.
let seeMove: () => void = () => undefined;
// A change of the slot's size, as its resize observer reports it.
let seeResize: () => void = () => undefined;

beforeEach(() => {
  seeMove = () => undefined;
  seeResize = () => undefined;
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        callback: (entries: { intersectionRatio: number }[]) => void,
      ) {
        seeMove = () => {
          callback([{ intersectionRatio: 1 }]);
        };
      }
      disconnect() {}
      observe() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        seeResize = callback;
      }
      disconnect() {}
      observe() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("follows the slot when it moves without resizing", () => {
  let x = 1064;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(x, 0, 728, 752),
  );
  render(<Slot />);
  expect(lastShownX()).toBe(1064);

  // A tab moved to the other side of its group: the slot moves, and its
  // size stays as it was.
  x = 328;
  seeMove();
  expect(lastShownX()).toBe(328);
});

it("follows a slot first measured with no size once it has one", () => {
  // A page brought up while the window's page waits in its hidden holder:
  // the slot has no size until the page is drawn in a side.
  let rect = new DOMRect(0, 0, 0, 0);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => rect,
  );
  render(<Slot />);
  rect = new DOMRect(328, 0, 628, 752);
  seeResize();
  expect(lastShownX()).toBe(328);

  // Moved to the other side of its group, at the same size.
  rect = new DOMRect(964, 0, 628, 752);
  seeMove();
  expect(lastShownX()).toBe(964);
});

it("follows a scroll of a box around the slot", () => {
  let x = 776;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(x, 0, 440, 752),
  );
  const { container } = render(<Slot />);

  x = 626;
  container.dispatchEvent(new Event("scroll"));
  expect(lastShownX()).toBe(626);
});

it("tells the pool only of moves", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(377, 0, 855, 752),
  );
  render(<Slot />);
  seeMove();
  document.dispatchEvent(new Event("scroll"));
  expect(showOverSlot).toHaveBeenCalledTimes(1);
});
