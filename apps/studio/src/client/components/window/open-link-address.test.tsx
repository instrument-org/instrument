// A link address names something that lives outside the tabs, so however it
// reaches them, no tab stands at it: a skill's address opens its folder in a
// tab of its own, the way Files shows any folder.
import { settingsModalAtom } from "@/client/atoms/settings-modal";
import { shortcutGuideModalAtom } from "@/client/atoms/shortcut-guide-modal";
import { TabIdSchema } from "@/shared/tabs";
import { ChatIdSchema } from "@instrument-org/workspace/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { createStore, getDefaultStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { skillHref } from "./tab-location";
import { appTabsAtom, useAppTabs } from "./app-tabs";
import { openLinkAddress } from "./open-link-address";
import { useWindowTabs, windowTabsAtom } from "./window-tabs";

const { showSkillFolder } = vi.hoisted(() => ({
  showSkillFolder: vi.fn<(name: string) => Promise<void>>(),
}));
vi.mock("@/client/lib/show-in-files", () => ({ showSkillFolder }));

const CHAT = ChatIdSchema.parse("2026-10-01-roofer");
const TAB = TabIdSchema.parse("tab");

afterEach(() => {
  getDefaultStore().set(settingsModalAtom, null);
  getDefaultStore().set(shortcutGuideModalAtom, null);
  showSkillFolder.mockReset();
});

describe("openLinkAddress", () => {
  it.each([
    ["a memory", "/memory/roofs", { memory: "roofs", tab: "Memory" }],
    ["a setting", "/settings/theme", { setting: "theme" }],
  ])(
    "opens %s in Settings and leaves no address for a tab",
    (_case, href, settings) => {
      expect(openLinkAddress(href)).toBeUndefined();
      expect(getDefaultStore().get(settingsModalAtom)).toEqual(settings);
    },
  );

  it("opens a skill's folder and leaves no address for a tab", async () => {
    expect(openLinkAddress("/skills/agents%3Ahandoff")).toBeUndefined();
    await vi.waitFor(() => {
      expect(showSkillFolder).toHaveBeenCalledWith("agents:handoff");
    });
    expect(getDefaultStore().get(settingsModalAtom)).toBeNull();
  });

  it("opens a named dialog over the window", () => {
    expect(openLinkAddress("/screen/shortcuts")).toBeUndefined();
    expect(getDefaultStore().get(shortcutGuideModalAtom)).toBe(true);
  });

  it.each([
    ["a named screen with a route", "/screen/apps", "/apps"],
    ["a screen of the window's", "/files", "/files"],
    ["a chat", `/chats/${CHAT}`, `/chats/${CHAT}`],
  ])("answers the address a tab stands at for %s", (_case, href, at) => {
    expect(openLinkAddress(href)).toBe(at);
    expect(getDefaultStore().get(settingsModalAtom)).toBeNull();
  });
});

/** The window's tabs and a group's, over one store, with a chat up. */
function renderTabs() {
  const store = createStore();
  const { result } = renderHook(
    () => ({ app: useAppTabs(), window: useWindowTabs() }),
    {
      // `useAppTabs` reads the output folder through a query, so the hook
      // needs a client as well as the store.
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    },
  );
  act(() => {
    store.set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: TAB,
      tabs: [{ id: TAB, pathname: `/chats/${CHAT}` }],
    });
  });
  return { result, store };
}

describe("a skill's address handed straight to the tabs", () => {
  it.each([
    ["a tab of the window's own", "open"],
    ["the tab up", "navigate"],
  ] as const)("opens the skill's folder rather than %s", async (_case, how) => {
    const { result, store } = renderTabs();
    act(() => {
      result.current.app[how](skillHref("handoff"));
    });
    expect(store.get(appTabsAtom).tabs.map((tab) => tab.pathname)).toEqual([
      `/chats/${CHAT}`,
    ]);
    await vi.waitFor(() => {
      expect(showSkillFolder).toHaveBeenCalledWith("handoff");
    });
  });

  it.each(["openScreen", "openOrFocusScreen"] as const)(
    "opens the skill's folder rather than a chat's tab (%s)",
    async (how) => {
      const { result, store } = renderTabs();
      let id: string | undefined;
      act(() => {
        id = result.current.window[how](skillHref("handoff"), { group: CHAT });
      });
      expect(id).toBeUndefined();
      expect(store.get(windowTabsAtom).tabs).toEqual([]);
      await vi.waitFor(() => {
        expect(showSkillFolder).toHaveBeenCalledWith("handoff");
      });
    },
  );
});
