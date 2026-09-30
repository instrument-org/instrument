import { inboxOpenAtom } from "@/client/atoms/window";
import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { useInboxRoom } from "./inbox-room";

const NEEDS = 600;
const NARROW = 400;
const WIDE = 1000;

beforeEach(() => {
  // The open atom is storage-backed with `getOnInit`.
  localStorage.clear();
});

/**
 * Mounts the hook the way the chat does, in a store that outlives it, and
 * keeps what every render said, so the first paint can be read apart from
 * where the effects settle.
 */
function mount(store: ReturnType<typeof createStore>, room: number) {
  const renders: { isCrossing: boolean; isShown: boolean }[] = [];
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Provider store={store}>{children}</Provider>
  );
  const hook = renderHook(
    ({ width }: { width: number }) => {
      const result = useInboxRoom({
        isActive: true,
        margin: 48,
        needs: NEEDS,
        room: width,
      });
      renders.push({ isCrossing: result.isCrossing, isShown: result.isShown });
      return result;
    },
    { initialProps: { width: room }, wrapper },
  );
  return { ...hook, renders };
}

describe("useInboxRoom", () => {
  it("arrives in a narrow row with the inbox already aside, and at once", () => {
    const store = createStore();
    const { renders, result } = mount(store, NARROW);

    expect(renders[0]).toEqual({ isCrossing: true, isShown: false });
    expect(renders.some((render) => render.isShown)).toBe(false);
    expect(result.current).toMatchObject({
      isCrossing: false,
      isShown: false,
      isSteppedAside: true,
    });
    expect(store.get(inboxOpenAtom)).toBe(false);
  });

  it("brings the inbox back when the row widens after it stepped aside", () => {
    const store = createStore();
    const { renders, rerender, result } = mount(store, NARROW);
    renders.length = 0;

    rerender({ width: WIDE });

    expect(renders[0]).toEqual({ isCrossing: true, isShown: true });
    expect(result.current.isShown).toBe(true);
    expect(store.get(inboxOpenAtom)).toBe(true);
  });

  it("arrives with the inbox back when the row widened while the chat was away", () => {
    const store = createStore();
    mount(store, NARROW).unmount();

    const { renders } = mount(store, WIDE);

    expect(renders[0]).toEqual({ isCrossing: true, isShown: true });
    expect(store.get(inboxOpenAtom)).toBe(true);
  });

  it("keeps an inbox brought back by hand in a narrow row", () => {
    const store = createStore();
    const { rerender, result } = mount(store, NARROW);

    store.set(inboxOpenAtom, true);
    rerender({ width: NARROW - 10 });

    expect(result.current).toMatchObject({
      isShown: true,
      isSteppedAside: false,
    });
  });

  it("leaves an inbox put away by hand alone when the row widens", () => {
    const store = createStore();
    store.set(inboxOpenAtom, false);
    const { rerender, result } = mount(store, NARROW);

    rerender({ width: WIDE });

    expect(result.current.isShown).toBe(false);
  });
});
