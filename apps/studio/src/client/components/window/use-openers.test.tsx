import { TabIdSchema } from "@/shared/tabs";
import { type WindowTabRequest } from "@instrument-org/workspace/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { appTabsAtom, useAppTabs } from "./app-tabs";
import { useOpeners } from "./use-openers";
import { groupHref } from "./window-href";
import {
  useWindowTabs,
  useWindowTabsChange,
  windowTabsAtom,
} from "./window-tabs";

const { agent, tabDone } = vi.hoisted(() => {
  const waiting: WindowTabRequest[] = [];
  let wake = () => {};
  return {
    agent: {
      /** Sends an agent's ask down the window's tab stream. */
      ask: (request: WindowTabRequest) => {
        waiting.push(request);
        wake();
      },
      async *stream() {
        for (;;) {
          const next = waiting.shift();
          if (next) {
            yield next;
          } else {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        }
      },
    },
    tabDone: vi.fn(async () => {}),
  };
});

/** A stream that stays open and sends nothing. */
function silent(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
  };
}

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    browser: {
      events: {
        bookmarkLink: { call: async () => silent() },
        openInNewTab: { call: async () => silent() },
      },
    },
    window: { events: { openMenuLink: { call: async () => silent() } } },
    workspace: {
      window: {
        events: { tab: { call: async () => agent.stream() } },
        tabDone: { call: tabDone },
      },
    },
  },
}));

vi.mock("@/client/bookmarks/actions", () => ({
  useAddBookmark: () => () => {},
}));

const GROUP = "group_a";
const CHAT_TAB = "tab_chat";
const LEFT_PAGE = "tab_left";
const RIGHT_UP = "tab_right_up";
const RIGHT_BEHIND = "tab_right_behind";
const WINDOW_TAB = TabIdSchema.parse("window");

/**
 * A window on a group of two sides: the person in the chat on the left, a
 * page up on the right with another waiting behind it.
 */
function windowOnTwoSides() {
  const store = createStore();
  const queryClient = new QueryClient();
  const { result } = renderHook(
    () => {
      const windowTabs = useWindowTabs();
      const appTabs = useAppTabs();
      const openers = useOpeners({
        appsBySlug: new Map(),
        appTabs,
        browser: null,
        chatTitles: new Map(),
        isOpen: true,
        newGroup: () => GROUP,
        openChat: () => {},
        showGroup: () => {},
        windowTabs,
      });
      return { change: useWindowTabsChange(), openers, windowTabs };
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    },
  );
  act(() => {
    store.set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: WINDOW_TAB,
      tabs: [{ id: WINDOW_TAB, pathname: groupHref(GROUP) }],
    });
  });
  act(() => {
    result.current.change(() => ({
      activeByGroup: { [GROUP]: CHAT_TAB },
      besideByGroup: { [GROUP]: RIGHT_UP },
      groups: {},
      tabs: [
        { group: GROUP, href: "/chats", id: CHAT_TAB, kind: "screen" },
        { group: GROUP, id: LEFT_PAGE, kind: "page", openedAt: 1 },
        { group: GROUP, id: RIGHT_UP, kind: "page", openedAt: 2, side: 1 },
        { group: GROUP, id: RIGHT_BEHIND, kind: "page", openedAt: 3, side: 1 },
      ],
    }));
  });
  return { result, store };
}

describe("an agent showing a tab already open", () => {
  it("brings it up on the other side, the keyboard staying with the person", async () => {
    const { result, store } = windowOnTwoSides();
    agent.ask({
      action: { kind: "show", tabId: RIGHT_BEHIND },
      requestId: "r1",
    });
    await waitFor(() => {
      expect(tabDone).toHaveBeenCalledWith({
        requestId: "r1",
        tabId: RIGHT_BEHIND,
      });
    });
    const layout = result.current.windowTabs.layoutOf(GROUP);
    expect(layout.focused).toBe(0);
    expect(layout.sides.map((side) => side.up)).toEqual([
      CHAT_TAB,
      RIGHT_BEHIND,
    ]);
    expect(store.get(windowTabsAtom).activeByGroup[GROUP]).toBe(CHAT_TAB);
  });

  it("brings one on the keyboard's own side up there", async () => {
    const { result } = windowOnTwoSides();
    agent.ask({ action: { kind: "show", tabId: LEFT_PAGE }, requestId: "r2" });
    await waitFor(() => {
      expect(tabDone).toHaveBeenCalledWith({
        requestId: "r2",
        tabId: LEFT_PAGE,
      });
    });
    const layout = result.current.windowTabs.layoutOf(GROUP);
    expect(layout.focused).toBe(0);
    expect(layout.sides.map((side) => side.up)).toEqual([LEFT_PAGE, RIGHT_UP]);
  });
});

describe("an app asked for in a tab of its own", () => {
  const APP = "/apps/github";
  const appTabs = (state: { tabs: { href?: string; id: string }[] }) =>
    state.tabs.filter((tab) => tab.href === APP).map((tab) => tab.id);

  it.each([
    ["behind, as a Cmd- or middle-click asks", true],
    ["up, as Open in New Tab asks", false],
  ])("opens %s", (_case, behind) => {
    const { result, store } = windowOnTwoSides();
    act(() => {
      result.current.openers.openScreen(APP, { behind, newTab: true });
    });
    const opened = appTabs(store.get(windowTabsAtom));
    expect(opened).toHaveLength(1);
    expect(result.current.windowTabs.active?.id).toBe(
      behind ? CHAT_TAB : opened[0],
    );
  });

  it("opens another tab behind when the app already has one", () => {
    const { result, store } = windowOnTwoSides();
    act(() => {
      result.current.openers.openScreen(APP);
    });
    const [first] = appTabs(store.get(windowTabsAtom));
    act(() => {
      result.current.windowTabs.select(CHAT_TAB);
    });
    act(() => {
      result.current.openers.openScreen(APP, { behind: true, newTab: true });
    });
    const opened = appTabs(store.get(windowTabsAtom));
    expect(opened).toHaveLength(2);
    expect(opened).toContain(first);
    expect(result.current.windowTabs.active?.id).toBe(CHAT_TAB);
  });

  it("comes up where it already is when not asked for a tab", () => {
    const { result, store } = windowOnTwoSides();
    act(() => {
      result.current.openers.openScreen(APP);
    });
    const [first] = appTabs(store.get(windowTabsAtom));
    act(() => {
      result.current.windowTabs.select(CHAT_TAB);
    });
    act(() => {
      result.current.openers.openScreen(APP);
    });
    expect(appTabs(store.get(windowTabsAtom))).toEqual([first]);
    expect(result.current.windowTabs.active?.id).toBe(first);
  });
});
