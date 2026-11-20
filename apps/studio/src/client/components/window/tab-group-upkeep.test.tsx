import { type TabRouter } from "@/client/lib/tab-router";
import { setTabRouter } from "@/client/lib/tab-router-registry";
import { TabIdSchema } from "@/shared/tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { type ReactNode, useSyncExternalStore } from "react";
import { describe, expect, it, vi } from "vitest";

import { appTabsAtom } from "./app-tabs";
import { windowTabGroupsAtom } from "./open-groups";
import { type TabGroup, useTabGroupUpkeep } from "./tab-groups";
import { groupHref, matchScreen } from "./window-href";
import { useWindowTabsChange, windowTabsAtom } from "./window-tabs";

vi.mock("@/client/lib/kept-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/client/lib/kept-state")>()),
  keptInOtherWindows: () => [],
}));

// Where Files starts is read from the computer's places, which no test here
// asks about.
vi.mock("@/client/hooks/use-files-start-href", () => ({
  useFilesStartHref: () => "/files?path=&root=~",
}));

// No other window lists a group.
vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    window: {
      live: {
        tabGroupsElsewhere: {
          experimental_liveOptions: () => ({
            queryFn: () => [],
            queryKey: ["tabGroupsElsewhere"],
          }),
        },
      },
    },
  },
}));

const WINDOW_TAB = TabIdSchema.parse("window");
const GROUP = "group:a";
const CHAT_TAB = "tab_chat";
/** Where the window's tab stands before a test sends it anywhere: a chat's address no chat has, which upkeep leaves alone. */
const NOWHERE_YET = "/chats/not-a-chat";

/**
 * A window with one group, its chat up, and the window's tab under upkeep,
 * walked by a history of its own as the window's router walks it.
 */
function windowWithGroup() {
  const store = createStore();
  const history = createMemoryHistory({ initialEntries: [NOWHERE_YET] });
  // Only the history a step moves: no route is mounted here.
  setTabRouter(WINDOW_TAB, { history } as unknown as TabRouter);
  const { result } = renderHook(
    () => {
      const href = useSyncExternalStore(
        (changed) => history.subscribe(changed),
        () => history.location.href,
      );
      const open = (useAtomValue(windowTabGroupsAtom) ?? []).map(
        (group) =>
          ({
            group,
            kind: "tabs",
            pinned: false,
            title: "",
          }) satisfies TabGroup,
      );
      useTabGroupUpkeep(href, open);
      return useWindowTabsChange();
    },
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={new QueryClient()}>
          <Provider store={store}>{children}</Provider>
        </QueryClientProvider>
      ),
    },
  );
  act(() => {
    store.set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: WINDOW_TAB,
      tabs: [{ id: WINDOW_TAB, pathname: NOWHERE_YET }],
    });
    store.set(windowTabGroupsAtom, [GROUP]);
    result.current(() => ({
      activeByGroup: { [GROUP]: CHAT_TAB },
      groups: {},
      tabs: [{ group: GROUP, href: "/chats", id: CHAT_TAB, kind: "screen" }],
    }));
  });
  const tabsAt = (href: string) =>
    store
      .get(windowTabsAtom)
      .tabs.filter((tab) => tab.kind === "screen" && tab.href === href);
  return { history, store, tabsAt };
}

describe("the window's tab at an address no screen answers", () => {
  const MISSING = "/removed-page?from=older-build";

  it("comes back from a launch as a tab of a group of its own, which the window stands on", () => {
    const { history, store, tabsAt } = windowWithGroup();
    act(() => {
      history.replace(MISSING);
    });
    const [tab] = tabsAt(MISSING);
    expect(tab).toBeDefined();
    expect(tab?.group).not.toBe(GROUP);
    expect(history.location.href).toBe(groupHref(tab?.group ?? ""));
    expect(store.get(windowTabGroupsAtom)).toEqual([tab?.group, GROUP]);
  });

  it("goes into the group the window stood on, sent there by a script", () => {
    const { history, tabsAt } = windowWithGroup();
    act(() => {
      history.replace(groupHref(GROUP));
    });
    act(() => {
      history.push(MISSING);
    });
    expect(tabsAt(MISSING)).toEqual([
      expect.objectContaining({ group: GROUP }),
    ]);
    expect(history.location.href).toBe(groupHref(GROUP));
  });
});

describe("the window's tab at a link address", () => {
  it("opens it where it lives and stands on its group again", () => {
    const { history, store } = windowWithGroup();
    act(() => {
      history.replace(groupHref(GROUP));
    });
    act(() => {
      history.push("/tab-groups/group-gone");
    });
    expect(history.location.href).toBe(groupHref(GROUP));
    expect(
      store
        .get(windowTabsAtom)
        .tabs.map((tab) =>
          tab.kind === "screen" ? matchScreen(tab.href).kind : tab.kind,
        ),
    ).toEqual(["inbox"]);
  });
});
