import { type TabRouter } from "@/client/lib/tab-router";
import { setTabRouter } from "@/client/lib/tab-router-registry";
import { TabIdSchema } from "@/shared/tabs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory } from "@tanstack/react-router";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider, useAtomValue } from "jotai";
import { type ReactNode, useSyncExternalStore } from "react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { appTabsAtom } from "./app-tabs";
import { sidebarRowOrderAtom } from "./held-chord-hints";
import { windowTabGroupsAtom } from "./open-groups";
import {
  type TabGroup,
  useTabGroupActions,
  useTabGroupUpkeep,
} from "./tab-groups";
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
            pinned: store.get(windowTabsAtom).groups?.[group]?.pinned === true,
            title: "",
          }) satisfies TabGroup,
      );
      useTabGroupUpkeep(href, open);
      return { change: useWindowTabsChange(), groups: useTabGroupActions() };
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
    result.current.change(() => ({
      activeByGroup: { [GROUP]: CHAT_TAB },
      groups: {},
      tabs: [{ group: GROUP, href: "/chats", id: CHAT_TAB, kind: "screen" }],
    }));
  });
  const tabsAt = (href: string) =>
    store
      .get(windowTabsAtom)
      .tabs.filter((tab) => tab.kind === "screen" && tab.href === href);
  return {
    actions: () => result.current.groups,
    change: result.current.change,
    history,
    store,
    tabsAt,
  };
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

describe("a group the window comes to stand on", () => {
  it("keeps when it came up, once per arrival", () => {
    vi.useFakeTimers({ now: 1000 });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { actions, history, store } = windowWithGroup();
    const shownAt = (group: string) =>
      store.get(windowTabsAtom).groups?.[group]?.shownAt;
    act(() => {
      history.replace(groupHref(GROUP));
    });
    expect(shownAt(GROUP)).toBe(1000);
    vi.setSystemTime(2000);
    let made = "";
    act(() => {
      made = actions().make({ href: "/files?path=/a" });
    });
    expect(shownAt(made)).toBe(2000);
    expect(shownAt(GROUP)).toBe(1000);
    vi.setSystemTime(3000);
    act(() => {
      actions().show(GROUP);
    });
    expect(shownAt(GROUP)).toBe(3000);
  });
});

describe("New", () => {
  it("comes back to the empty group the window has rather than making a second", () => {
    const { actions, history, store } = windowWithGroup();
    act(() => {
      history.replace(groupHref(GROUP));
    });
    let other = "";
    act(() => {
      other = actions().make({ href: "/files?path=/a" });
    });
    expect(history.location.href).toBe(groupHref(other));
    act(() => {
      actions().openNew();
    });
    expect(history.location.href).toBe(groupHref(GROUP));
    expect(store.get(windowTabGroupsAtom)).toEqual([other, GROUP]);
  });

  it("takes the keyboard off a row of the empty group already up, for its box", () => {
    const { actions, history, store } = windowWithGroup();
    act(() => {
      history.replace(groupHref(GROUP));
      store.set(appTabsAtom, {
        recentlyClosed: [],
        selectedId: WINDOW_TAB,
        tabs: [{ id: WINDOW_TAB, pathname: groupHref(GROUP) }],
      });
    });
    const row = document.createElement("button");
    document.body.append(row);
    onTestFinished(() => {
      row.remove();
    });
    row.focus();
    expect(document.activeElement).toBe(row);
    act(() => {
      actions().openNew();
    });
    expect(history.location.href).toBe(groupHref(GROUP));
    expect(document.activeElement).toBe(document.body);
  });

  it("makes a group where none is empty", () => {
    const { actions, history, store } = windowWithGroup();
    act(() => {
      history.replace(groupHref(GROUP));
    });
    act(() => {
      store.set(windowTabGroupsAtom, []);
      actions().openNew();
    });
    const [made] = store.get(windowTabGroupsAtom) ?? [];
    expect(made).not.toBe(GROUP);
    expect(history.location.href).toBe(groupHref(made ?? ""));
  });
});

describe("a group brought up in an empty one's place", () => {
  it("stands where the empty one stood, which leaves the list, with no step back to it", () => {
    const { actions, history, store } = windowWithGroup();
    act(() => {
      history.replace(groupHref(GROUP));
    });
    let above = "";
    act(() => {
      above = actions().make({ href: "/files?path=/a" });
    });
    act(() => {
      actions().show(GROUP);
    });
    const steps = history.length;
    let made = "";
    act(() => {
      made = actions().make({
        href: "/files?path=/b",
        place: { after: GROUP },
        replace: true,
      });
      actions().closeAll([GROUP], made);
    });
    expect(store.get(windowTabGroupsAtom)).toEqual([above, made]);
    expect(history.location.href).toBe(groupHref(made));
    expect(history.length).toBe(steps);
    expect(store.get(windowTabsAtom).tabs.map((tab) => tab.group)).toEqual([
      above,
      made,
    ]);
  });
});

describe("the group that comes up as one closes", () => {
  // The window's own list, where a pinned group keeps the place it had.
  const LISTED = ["group:a", "group:pin1", "group:b", "group:pin2", "group:c"];
  const PINNED = ["group:pin1", "group:pin2"];
  const entries = (listed: readonly string[]) =>
    listed.map(
      (group) =>
        ({
          group,
          kind: "tabs",
          pinned: PINNED.includes(group),
          title: "",
        }) satisfies TabGroup,
    );
  const windowOnGroups = (up: string) => {
    const window = windowWithGroup();
    act(() => {
      window.change(() => ({
        activeByGroup: {},
        groups: Object.fromEntries(
          PINNED.map((group) => [group, { pinned: true }]),
        ),
        tabs: LISTED.map((group) => ({
          group,
          href: "/apps",
          id: `tab:${group}`,
          kind: "screen",
        })),
      }));
      window.store.set(windowTabGroupsAtom, LISTED);
    });
    act(() => {
      window.history.replace(groupHref(up));
      // What the router's own tab writes once a step resolves, which a close
      // reads before the next one has.
      window.store.set(appTabsAtom, {
        recentlyClosed: [],
        selectedId: WINDOW_TAB,
        tabs: [{ id: WINDOW_TAB, pathname: groupHref(up) }],
      });
    });
    return window;
  };

  it.each([
    ["the row under it, past a pinned group listed between", "a", "b"],
    ["the row under it", "b", "c"],
    ["the row above, for the last row", "c", "b"],
    ["the next pinned row", "pin1", "pin2"],
    ["the first row under the line, for the last pinned row", "pin2", "a"],
  ])("is %s", (_case, closing, next) => {
    const { actions, history } = windowOnGroups(`group:${closing}`);
    act(() => {
      actions().close(`group:${closing}`, entries(LISTED));
    });
    expect(history.location.href).toBe(groupHref(`group:${next}`));
  });

  it("is the row under it as the sidebar shows them", () => {
    const { actions, history, store } = windowOnGroups("group:a");
    act(() => {
      store.set(sidebarRowOrderAtom, ["group:pin1", "group:a", "group:c"]);
      actions().close("group:a", entries(LISTED));
    });
    expect(history.location.href).toBe(groupHref("group:c"));
  });

  it("goes on down the rows over two closes before a render, the model still on the first", () => {
    const { actions, history, store } = windowOnGroups("group:a");
    act(() => {
      const { close, groupUp } = actions();
      close(groupUp() ?? "", entries(LISTED));
      close(groupUp() ?? "", entries(LISTED));
    });
    expect(history.location.href).toBe(groupHref("group:c"));
    expect(store.get(windowTabGroupsAtom)).toEqual([
      "group:pin1",
      "group:pin2",
      "group:c",
    ]);
  });

  const closed = (window: ReturnType<typeof windowOnGroups>) => {
    const { groupUp } = window.actions();
    act(() => {
      window.actions().close(groupUp() ?? "", entries(LISTED));
    });
    return window.history.location.href;
  };
  const arriveAt = (
    { history, store }: ReturnType<typeof windowOnGroups>,
    group: string,
  ) => {
    act(() => {
      history.push(groupHref(group));
      store.set(appTabsAtom, (model) => ({
        ...model,
        tabs: [{ id: WINDOW_TAB, pathname: groupHref(group) }],
      }));
    });
  };

  it("is the one a new group was made in", () => {
    const window = windowOnGroups("group:b");
    act(() => {
      window.actions().openNew();
    });
    expect(closed(window)).toBe(groupHref("group:b"));
  });

  it("is a neighbor of a new group once switched away from", () => {
    const window = windowOnGroups("group:b");
    act(() => {
      window.actions().openNew();
    });
    const { groupUp } = window.actions();
    const made = groupUp() ?? "";
    arriveAt(window, "group:b");
    arriveAt(window, made);
    expect(closed(window)).not.toBe(groupHref("group:b"));
  });

  it.each([
    ["the one it was opened from, looked at in between", "group:b", true],
    ["a neighbor, once another was looked at", "group:c", false],
  ])("for a group opened from another is %s", (_case, between, isBack) => {
    const window = windowOnGroups("group:b");
    act(() => {
      window.actions().make({
        href: "/apps",
        returns: "untilUnrelated",
      });
    });
    const { groupUp } = window.actions();
    const made = groupUp() ?? "";
    arriveAt(window, between);
    arriveAt(window, made);
    expect(closed(window) === groupHref("group:b")).toBe(isBack);
  });
});
