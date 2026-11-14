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

beforeEach(() => {
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
