// @vitest-environment jsdom
import { sidebarOpenAtom } from "@/client/atoms/tab-groups";
import { act, cleanup, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TrafficLightsWithSidebar } from "./inbox-toggle";

const stands = vi.hoisted(() => ({
  fullScreen: false,
  setup: false,
  show: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    utils: {
      live: { windowState: { experimental_liveOptions: () => ({}) } },
      showTrafficLights: { call: stands.show },
    },
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { fullScreen: stands.fullScreen } }),
}));
vi.mock("@/client/components/setup/use-setup-state", () => ({
  useIsSetupUp: () => stands.setup,
}));
vi.mock("@/client/lib/utils", () => ({ cn: () => "", isMacOS: () => true }));
vi.mock("@/client/components/toolbar-tooltip", () => ({
  ToolbarTooltip: () => null,
}));
vi.mock("@/client/components/ui/button", () => ({ Button: () => null }));

function shown() {
  return stands.show.mock.calls.flat();
}

function draw(isOpen: boolean) {
  const store = createStore();
  store.set(sidebarOpenAtom, isOpen);
  const view = render(
    <Provider store={store}>
      <TrafficLightsWithSidebar />
    </Provider>,
  );
  return { store, ...view };
}

beforeEach(() => {
  vi.useFakeTimers();
  stands.fullScreen = false;
  stands.setup = false;
  stands.show.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("the traffic lights beside the sidebar", () => {
  it("come back once the sidebar's slide is past them", () => {
    const { store } = draw(false);
    expect(shown()).toEqual([{ isShown: false }]);
    act(() => {
      store.set(sidebarOpenAtom, true);
    });
    expect(shown()).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(shown().at(-1)).toEqual({ isShown: true });
  });

  it("stay away when the sidebar is closed again mid-slide", () => {
    const { store } = draw(false);
    act(() => {
      store.set(sidebarOpenAtom, true);
    });
    act(() => {
      store.set(sidebarOpenAtom, false);
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(shown()).not.toContainEqual({ isShown: true });
  });

  it("are there at once in a window that opens with its sidebar out", () => {
    draw(true);
    expect(shown()).toEqual([{ isShown: true }]);
  });

  it.each(["fullScreen", "setup"] as const)(
    "show over a closed sidebar in %s, and go when it ends",
    (over) => {
      stands[over] = true;
      const { rerender, store } = draw(false);
      expect(shown()).toEqual([{ isShown: true }]);
      stands[over] = false;
      rerender(
        <Provider store={store}>
          <TrafficLightsWithSidebar />
        </Provider>,
      );
      expect(shown().at(-1)).toEqual({ isShown: false });
    },
  );

  it("are left shown by a window that crashed", () => {
    const { unmount } = draw(false);
    unmount();
    expect(shown().at(-1)).toEqual({ isShown: true });
  });
});
