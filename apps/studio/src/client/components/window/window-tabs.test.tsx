import { BROWSER_HREF } from "@/client/atoms/window";
import {
  deleteGroupTabRouter,
  getGroupTabRouter,
  setGroupTabRouter,
} from "@/client/lib/group-tab-router-registry";
import { type TabRouter } from "@/client/lib/tab-router";
import { TabIdSchema } from "@/shared/tabs";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { appTabsAtom } from "./app-tabs";
import {
  groupOnScreenAtom,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";

const CHAT = ChatIdSchema.parse("2026-10-01-roofer");
const GROUP = "group:1";
const OTHER = "group:2";
/** The window's tab standing on a group, as `groupHref` addresses it. */
const ON_GROUP = `/chats?group=${encodeURIComponent(GROUP)}`;

const TAB = TabIdSchema.parse("tab");

/** A window whose tab up stands at an address, and its tabs as a component reads them. */
function at(pathname: string) {
  const store = createStore();
  const { result } = renderHook(() => useWindowTabs(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
  // Once mounted, since mounting reads the tabs back from storage.
  act(() => {
    store.set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: TAB,
      tabs: [{ id: TAB, pathname }],
    });
  });
  return { result, store };
}

describe("the group on screen", () => {
  it.each([
    ["a group", ON_GROUP, GROUP],
    ["a chat asked for by its address", `/chats/${CHAT}`, undefined],
    ["the inbox alone", "/chats", undefined],
    ["a site of the window's own", "/sites/abc", "site:abc"],
    ["a screen that is its own route", "/files", undefined],
  ])("is the one %s stands on", (_case, pathname, expected) => {
    const { result, store } = at(pathname);
    expect(store.get(groupOnScreenAtom)).toBe(expected);
    expect(result.current.groupOnScreen).toBe(expected);
  });
});

describe("opening into a group", () => {
  it("brings a screen up in the group on screen, and leaves one opened into another group waiting there", () => {
    const { result, store } = at(ON_GROUP);
    let here: string | undefined;
    act(() => {
      here = result.current.openScreen(BROWSER_HREF);
      result.current.openScreen(BROWSER_HREF, { group: OTHER });
    });
    expect(result.current.active?.id).toBe(here);
    expect(store.get(windowTabsAtom).activeByGroup).toEqual({ [GROUP]: here });
    expect(store.get(windowTabsAtom).activeByGroup).not.toHaveProperty(OTHER);
  });

  it("sees, within one tick, what the change before it did", () => {
    const { result } = at(ON_GROUP);
    let first: string | undefined;
    let second: string | undefined;
    act(() => {
      first = result.current.openOrFocusScreen("/apps");
      second = result.current.openOrFocusScreen("/apps");
    });
    expect(second).toBe(first);
    expect(result.current.tabs).toHaveLength(1);
  });

  it("walks a screen tab up to another screen by its own router, keeping it", () => {
    const { result } = at(ON_GROUP);
    let id: string | undefined;
    act(() => {
      id = result.current.openScreen(BROWSER_HREF);
    });
    if (id === undefined) {
      throw new Error("no screen tab opened");
    }
    // The tabs walk a screen tab by its router's history alone, so a router
    // with just that stands in for one over the app's whole route tree, which
    // would cost this file most of its import time.
    const router = {
      history: createMemoryHistory({ initialEntries: [BROWSER_HREF] }),
    } as TabRouter;
    setGroupTabRouter(id, router);
    act(() => {
      result.current.navigateScreen("/apps");
    });
    expect(getGroupTabRouter(id)).toBe(router);
    expect(router.history.location.pathname).toBe("/apps");
    expect(router.history.length).toBe(2);
    deleteGroupTabRouter(id);
  });
});

describe("the tab groups kept on this computer", () => {
  /** A group of two sides as `tab-groups.v3` keeps it, the keyboard on the right. */
  const MEMBER = {
    focused: 1,
    pinned: true,
    share: 0.4,
    sides: [
      {
        tabs: [
          { id: "tab_1", kind: "page", openedAt: 1 },
          { id: "tab_2", kind: "page", openedAt: 2 },
        ],
        up: "tab_2",
      },
      { tabs: [{ href: "/chats", id: "tab_3", kind: "screen" }], up: "tab_3" },
    ],
  };

  it("are read and written back in the v3 shape, and nothing an earlier key kept is read", async () => {
    vi.resetModules();
    const set = vi.fn();
    Object.defineProperty(window, "api", {
      configurable: true,
      value: {
        keptState: {
          initial: {
            groups: {
              "tab-groups.v2/group_b": {
                active: "tab_9",
                tabs: [{ group: "group_b", id: "tab_9", kind: "page" }],
              },
              "tab-groups.v3/group_a": MEMBER,
            },
          },
          onChange: () => () => {},
          set,
        },
      },
    });
    const { useWindowTabs: use, windowTabsAtom: read } =
      await import("./window-tabs");
    const store = createStore();

    expect(store.get(read)).toEqual({
      activeByGroup: { group_a: "tab_3" },
      besideByGroup: { group_a: "tab_2" },
      groups: { group_a: { pinned: true, share: 0.4 } },
      tabs: [
        { group: "group_a", id: "tab_1", kind: "page", openedAt: 1 },
        { group: "group_a", id: "tab_2", kind: "page", openedAt: 2 },
        { group: "group_a", href: "/chats", id: "tab_3", kind: "screen", side: 1 },
      ],
    });

    const { result } = renderHook(() => use(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    });
    act(() => {
      result.current.setGroupOwn("group_a", { share: 0.5 });
    });

    expect(set.mock.calls).toEqual([
      ["groups", "tab-groups.v3/group_a", { ...MEMBER, share: 0.5 }],
    ]);
    Reflect.deleteProperty(window, "api");
    vi.resetModules();
  });
});
