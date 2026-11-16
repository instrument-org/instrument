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
async function* silent(): AsyncGenerator<never> {
  await new Promise(() => {});
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
        { group: GROUP, id: LEFT_PAGE, kind: "page" },
        { group: GROUP, id: RIGHT_UP, kind: "page", side: 1 },
        { group: GROUP, id: RIGHT_BEHIND, kind: "page", side: 1 },
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
