import { BROWSER_HREF } from "@/client/atoms/window";
import { TabIdSchema } from "@/shared/tabs";
import { StoreId } from "@instrument-org/workspace/client";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { appTabsAtom } from "./app-tabs";
import {
  groupOnScreenAtom,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";

const CHAT = StoreId.SessionSchema.parse("ses_01JAAAAAAAAAAAAAAAAAAAAAAA");
const OTHER = StoreId.SessionSchema.parse("ses_01JBBBBBBBBBBBBBBBBBBBBBBB");

const TAB = TabIdSchema.parse("tab");

// The tabs are kept in storage, which outlives each test's store.
beforeEach(() => {
  localStorage.clear();
});

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
  it("brings a screen up in the group on screen, and leaves one opened into a group behind waiting", () => {
    const { result, store } = at(`/chats/${CHAT}`);
    let here: string | undefined;
    let there: string | undefined;
    act(() => {
      here = result.current.openScreen(BROWSER_HREF);
      there = result.current.openScreen(BROWSER_HREF, { group: OTHER });
    });
    expect(result.current.active?.id).toBe(here);
    expect(store.get(windowTabsAtom).activeByGroup).toEqual({ [CHAT]: here });
    expect(result.current.tabUpIn(OTHER)?.id).toBe(there);
    // A second tab behind does not take the first's place.
    act(() => {
      result.current.openScreen("/apps", { group: OTHER });
    });
    expect(result.current.tabUpIn(OTHER)?.id).toBe(there);
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
});
