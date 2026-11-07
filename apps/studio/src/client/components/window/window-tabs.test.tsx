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
const OTHER = ChatIdSchema.parse("2026-10-02-trip");

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
    ["a chat", `/chats/${CHAT}`, CHAT],
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
  it("brings a screen up in the group on screen, and leaves one opened into a chat behind waiting with nothing up", () => {
    const { result, store } = at(`/chats/${CHAT}`);
    let here: string | undefined;
    act(() => {
      here = result.current.openScreen(BROWSER_HREF);
      result.current.openScreen(BROWSER_HREF, { group: OTHER });
    });
    expect(result.current.active?.id).toBe(here);
    expect(store.get(windowTabsAtom).activeByGroup).toEqual({ [CHAT]: here });
    expect(result.current.selectedTabIn(OTHER)).toBeUndefined();
  });

  it("sees, within one tick, what the change before it did", () => {
    const { result } = at(`/chats/${CHAT}`);
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
    const { result } = at(`/chats/${CHAT}`);
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

describe("the tabs a build with one window kept", () => {
  it("are read as every window keeps them, group by group, tabs with no group among them", async () => {
    vi.resetModules();
    const kept = await import("@/client/lib/kept-state");
    kept.clearKeptState();
    kept.writeKept("layout", "window-tabs.v9", {
      activeByGroup: { chat_a: "tab_1" },
      tabs: [
        { group: "chat_a", id: "tab_1", kind: "page", openedAt: 1 },
        { id: "tab_2", kind: "page", openedAt: 2 },
      ],
    });

    const { windowTabsAtom: migrated } = await import("./window-tabs");

    expect(createStore().get(migrated)).toEqual({
      activeByGroup: { chat_a: "tab_1" },
      tabs: [
        { group: "chat_a", id: "tab_1", kind: "page", openedAt: 1 },
        { id: "tab_2", kind: "page", openedAt: 2 },
      ],
    });
    expect(kept.takeKept("layout", "window-tabs.v9")).toBeUndefined();
    vi.resetModules();
  });
});
