import { TabIdSchema } from "@/shared/tabs";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { appTabsAtom, useAppTabs } from "./app-tabs";

const CHAT = ChatIdSchema.parse("2026-10-01-roofer");
const OTHER = ChatIdSchema.parse("2026-10-02-trip");
const HOME = TabIdSchema.parse("home");

function window(pathname = "/chats") {
  const store = createStore();
  const { result } = renderHook(() => useAppTabs(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
  // Once mounted, since mounting reads the tabs back from storage.
  act(() => {
    store.set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: HOME,
      tabs: [{ id: HOME, pathname }],
    });
  });
  const tabsAt = (at: string) =>
    store.get(appTabsAtom).tabs.filter((tab) => tab.pathname === at);
  return { result, store, tabsAt };
}

describe("openOrFocusChat", () => {
  it("opens one tab for two calls from the same render", () => {
    const { result, tabsAt } = window();
    // What a window on its way out of the screen holds: the handlers of the
    // render before the first call, which never saw the tab it opened.
    const { openOrFocusChat } = result.current;

    act(() => {
      openOrFocusChat(CHAT);
    });
    act(() => {
      openOrFocusChat(CHAT);
    });

    expect(tabsAt(`/chats/${CHAT}`)).toHaveLength(1);
  });

  it("opens one tab for two calls before a render", () => {
    const { result, tabsAt } = window();

    act(() => {
      result.current.openOrFocusChat(CHAT);
      result.current.openOrFocusChat(CHAT);
    });

    expect(tabsAt(`/chats/${CHAT}`)).toHaveLength(1);
  });

  it("brings up the tab that has the chat instead of opening another", () => {
    const { result, store, tabsAt } = window(`/chats/${CHAT}`);
    act(() => {
      result.current.openOrFocusChat(OTHER);
    });
    expect(store.get(appTabsAtom).selectedId).not.toBe(HOME);

    act(() => {
      result.current.openOrFocusChat(CHAT);
    });

    expect(store.get(appTabsAtom).selectedId).toBe(HOME);
    expect(tabsAt(`/chats/${CHAT}`)).toHaveLength(1);
  });

  it("opens a new tab with the chat up when none has it", () => {
    const { result, store, tabsAt } = window();

    act(() => {
      result.current.openOrFocusChat(CHAT);
    });

    const [opened] = tabsAt(`/chats/${CHAT}`);
    expect(store.get(appTabsAtom).selectedId).toBe(opened?.id);
  });
});
