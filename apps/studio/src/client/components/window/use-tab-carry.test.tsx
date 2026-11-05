import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { endTabCarry, noteTabCarry, startTabCarry } = vi.hoisted(() => ({
  endTabCarry: vi.fn(() => Promise.resolve({ kind: "none" })),
  noteTabCarry: vi.fn(() => Promise.resolve()),
  startTabCarry: vi.fn(() => Promise.resolve({ collapsesOffRow: true })),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    window: {
      endTabCarry: { call: endTabCarry },
      events: { tabCarry: { call: vi.fn() } },
      noteTabCarry: { call: noteTabCarry },
      startTabCarry: { call: startTabCarry },
    },
  },
}));
vi.mock("@/client/lib/tab-view-state", () => ({
  afterNextPaint: () => Promise.resolve(),
}));
vi.mock("./move-tab", () => ({
  settleTabMove: vi.fn(),
  tabStanding: (id: string) => ({
    neighborPages: [],
    pages: [],
    tab: { id, pathname: `/${id}` },
  }),
}));

const { useTabCarry } = await import("./use-tab-carry");

/** The event a drag gets from the reorder, which can say when it happened. */
const moved = (timeStamp: number, y = 20) =>
  ({
    clientX: 50,
    clientY: y,
    screenX: 150,
    screenY: y + 100,
    timeStamp,
  }) as PointerEvent;

/** The pointer's own release, as the window hears it. */
const letGo = (init: PointerEventInit = {}) => {
  window.dispatchEvent(
    new PointerEvent("pointerup", {
      clientX: 50,
      clientY: 20,
      isPrimary: true,
      screenX: 150,
      screenY: 120,
      ...init,
    }),
  );
};

const isHeld = () =>
  document.documentElement.hasAttribute("data-tab-held") as boolean;

const flush = () => new Promise((resolve) => setTimeout(resolve));

const onSelect = vi.fn();

function renderCarry() {
  return renderHook(() =>
    useTabCarry({
      isOnlyTab: false,
      onCancel: vi.fn(),
      onPlace: vi.fn(),
      onSelect,
      order: ["a", "b"],
    }),
  ).result;
}

beforeEach(() => {
  endTabCarry.mockClear();
  noteTabCarry.mockClear();
  startTabCarry.mockClear();
  onSelect.mockClear();
  document.body.innerHTML = `<div data-app-tab-strip><div role="tablist"><div data-tab-key="a"></div></div></div>`;
});

afterEach(() => {
  letGo();
});

describe("a tab's release", () => {
  it("ends a drag let go before it started, with nothing left following the pointer", async () => {
    const carry = renderCarry();
    // The reorder reports both on one frame, after the release has gone by.
    carry.current.onDragStart("a", moved(10));
    carry.current.onDragEnd("a", moved(11));
    await flush();

    expect(startTabCarry).not.toHaveBeenCalled();
    expect(isHeld()).toBe(false);
    expect(endTabCarry).toHaveBeenCalledTimes(1);
  });

  it("is heard as it happens, and the reorder's word on it after that changes nothing", async () => {
    const carry = renderCarry();
    carry.current.onDragStart("a", moved(0));
    await flush();
    expect(startTabCarry).toHaveBeenCalledTimes(1);

    letGo();
    expect(isHeld()).toBe(false);
    expect(endTabCarry).toHaveBeenCalledTimes(1);

    carry.current.onDragEnd("a", moved(1));
    expect(endTabCarry).toHaveBeenCalledTimes(1);
  });

  it("does not end the next drag when the reorder is late with the last one", async () => {
    const carry = renderCarry();
    carry.current.onDragStart("a", moved(100));
    await flush();

    carry.current.onDragEnd("a", moved(50));
    expect(endTabCarry).not.toHaveBeenCalled();
    expect(isHeld()).toBe(true);
  });

  it("waits for the finger holding the tab when another one lifts", async () => {
    const carry = renderCarry();
    carry.current.onDragStart("a", moved(0));
    await flush();

    letGo({ isPrimary: false });
    expect(endTabCarry).not.toHaveBeenCalled();

    letGo();
    expect(endTabCarry).toHaveBeenCalledTimes(1);
  });

  it("says where the tab ended up, since the last movement waits for a frame", async () => {
    const carry = renderCarry();
    carry.current.onDragStart("a", moved(0));
    await flush();

    letGo({ clientY: 400, screenY: 500 });

    expect(noteTabCarry).toHaveBeenCalledWith({
      isOffRow: true,
      x: 150,
      y: 500,
    });
    expect(noteTabCarry.mock.invocationCallOrder[0]).toBeLessThan(
      endTabCarry.mock.invocationCallOrder[0] ?? 0,
    );
  });
});

describe("a tab pulled off its row", () => {
  const OFF_ROW = 400;

  it("leaves its strip as if it had gone, with the tab beside it up", async () => {
    const carry = renderCarry();
    carry.current.onDragStart("a", moved(0));
    await flush();
    act(() => {
      carry.current.onDrag("a", moved(1, OFF_ROW));
    });

    expect(carry.current.carriedKey).toBe("a");
    expect(onSelect).toHaveBeenLastCalledWith("b");
  });

  it("comes back to its place and its selection on the row", async () => {
    const carry = renderCarry();
    carry.current.onDragStart("a", moved(0));
    await flush();
    act(() => {
      carry.current.onDrag("a", moved(1, OFF_ROW));
    });
    act(() => {
      carry.current.onDrag("a", moved(2, 20));
    });

    expect(carry.current.carriedKey).toBeUndefined();
    expect(onSelect).toHaveBeenLastCalledWith("a");
  });

  it("stays in its strip where nothing can go with the pointer", async () => {
    startTabCarry.mockResolvedValueOnce({ collapsesOffRow: false });
    const carry = renderCarry();
    carry.current.onDragStart("a", moved(0));
    await flush();
    act(() => {
      carry.current.onDrag("a", moved(1, OFF_ROW));
    });

    expect(carry.current.carriedKey).toBeUndefined();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
