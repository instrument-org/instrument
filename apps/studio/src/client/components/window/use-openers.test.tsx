import { TabIdSchema } from "@/shared/tabs";
import { type WindowTabRequest } from "@instrument-org/workspace/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeTabGroup } from "@/client/lib/tabs-model";

import { appTabsAtom, useAppTabs } from "./app-tabs";
import { windowTabGroupsAtom } from "./open-groups";
import { openLinkAddress } from "./open-link-address";
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

const spies = vi.hoisted(() => ({
  closeGroup: vi.fn((_group: string) => true),
  closeTab: vi.fn((_id: string) => {}),
  groupTabs: vi.fn((_ids: readonly string[]) => "group_made"),
  moveTabs: vi.fn((_ids: readonly string[], _group: string) => {}),
  closedEntry: { current: undefined as string | undefined },
  reopenClosed: vi.fn((_entry: string) => {}),
  showGroup: vi.fn((_group: string) => {}),
  toast: vi.fn(),
}));

vi.mock("@/client/lib/toast", () => ({ toast: spies.toast }));

/** A stream that stays open and sends nothing. */
function silent(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
  };
}

vi.mock("@/client/rpc/client", () => ({
  rpcClient: {
    actions: {
      list: {
        call: async () => ({
          actions: [
            {
              at: "2026-11-15T09:00:00.000Z",
              kind: "page",
              title: "Example Domain",
              url: "https://example.com/",
            },
          ],
          next: null,
        }),
      },
    },
    browser: {
      events: {
        bookmarkLink: { call: async () => silent() },
        openInNewTab: { call: async () => silent() },
      },
    },
    window: {
      bringForward: { call: async () => {} },
      events: { openMenuLink: { call: async () => silent() } },
      tabGroupsByWindow: {
        call: async () => [
          { groups: [GROUP, OTHER_GROUP], isThisWindow: true, shown: GROUP },
        ],
      },
    },
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
const OTHER_GROUP = "group_b";
const OTHER_UP = "tab_b_up";
const OTHER_BEHIND = "tab_b_behind";

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
        closedEntryOf: () => spies.closedEntry.current,
        closeGroup: spies.closeGroup,
        closeTab: spies.closeTab,
        groupTabs: spies.groupTabs,
        isOpen: true,
        moveTabs: spies.moveTabs,
        newGroup: () => GROUP,
        openChat: () => {},
        reopenClosed: spies.reopenClosed,
        showGroup: spies.showGroup,
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
    store.set(windowTabGroupsAtom, [GROUP, OTHER_GROUP]);
    store.set(appTabsAtom, {
      recentlyClosed: [],
      selectedId: WINDOW_TAB,
      tabs: [{ id: WINDOW_TAB, pathname: groupHref(GROUP) }],
    });
  });
  act(() => {
    result.current.change(() => ({
      activeByGroup: { [GROUP]: CHAT_TAB, [OTHER_GROUP]: OTHER_UP },
      besideByGroup: { [GROUP]: RIGHT_UP },
      groups: {},
      tabs: [
        { group: GROUP, href: "/chats", id: CHAT_TAB, kind: "screen" },
        { group: GROUP, id: LEFT_PAGE, kind: "page", openedAt: 1 },
        { group: GROUP, id: RIGHT_UP, kind: "page", openedAt: 2, side: 1 },
        { group: GROUP, id: RIGHT_BEHIND, kind: "page", openedAt: 3, side: 1 },
        { group: OTHER_GROUP, id: OTHER_UP, kind: "page", openedAt: 4 },
        { group: OTHER_GROUP, id: OTHER_BEHIND, kind: "page", openedAt: 5 },
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

beforeEach(() => {
  vi.clearAllMocks();
  spies.closedEntry.current = undefined;
});

/** Sends an ask down the tab stream and waits for the window's answer to it. */
async function answerTo(action: WindowTabRequest["action"], requestId: string) {
  agent.ask({ action, requestId });
  await waitFor(() => {
    expect(tabDone).toHaveBeenCalledWith(
      expect.objectContaining({ requestId }),
    );
  });
  return tabDone.mock.calls
    .map(([answer]: unknown[]) => answer)
    .find(
      (answer): answer is { requestId: string } =>
        typeof answer === "object" &&
        answer !== null &&
        "requestId" in answer &&
        answer.requestId === requestId,
    );
}

describe("an agent and the window's other tab groups", () => {
  it("lists every group of the window, the one not on screen marked so", async () => {
    windowOnTwoSides();
    const answer = await answerTo({ kind: "list" }, "l1");
    const windows = (answer as { windows?: unknown }).windows as {
      groups: { group: { id: string }; isShown?: boolean }[];
      isThisWindow?: boolean;
    }[];
    expect(
      windows.map((window) => ({
        groups: window.groups.map((group) => [group.group.id, group.isShown]),
        isThisWindow: window.isThisWindow,
      })),
    ).toEqual([
      {
        groups: [
          [GROUP, undefined],
          [OTHER_GROUP, false],
        ],
        isThisWindow: true,
      },
    ]);
  });

  it("switches the window to a group by its id", async () => {
    windowOnTwoSides();
    await answerTo({ group: OTHER_GROUP, kind: "showGroup" }, "g1");
    expect(spies.showGroup).toHaveBeenCalledWith(OTHER_GROUP);
  });

  it("refuses a group that is not open", async () => {
    windowOnTwoSides();
    const answer = await answerTo(
      { group: "group_gone", kind: "showGroup" },
      "g2",
    );
    expect(answer).toEqual({
      error: "no tab group group_gone is open.",
      requestId: "g2",
    });
    expect(spies.showGroup).not.toHaveBeenCalled();
  });

  it("takes the person to a tab in a group not on screen, up on its side", async () => {
    const { result } = windowOnTwoSides();
    await answerTo({ kind: "show", tabId: OTHER_BEHIND }, "t1");
    expect(spies.showGroup).toHaveBeenCalledWith(OTHER_GROUP);
    expect(result.current.windowTabs.layoutOf(OTHER_GROUP).sides[0]?.up).toBe(
      OTHER_BEHIND,
    );
  });

  it("leaves the group on screen for a tab in it", async () => {
    windowOnTwoSides();
    await answerTo({ kind: "show", tabId: RIGHT_BEHIND }, "t2");
    expect(spies.showGroup).not.toHaveBeenCalled();
  });

  it("opens into another group without switching the window to it", async () => {
    const { result, store } = windowOnTwoSides();
    const answer = await answerTo(
      {
        group: OTHER_GROUP,
        kind: "open",
        show: true,
        target: { address: "instrument://app/github", kind: "app" },
      },
      "o1",
    );
    const opened = store
      .get(windowTabsAtom)
      .tabs.find((tab) => tab.id === (answer as { tabId?: string }).tabId);
    expect(opened?.group).toBe(OTHER_GROUP);
    expect(result.current.windowTabs.groupOnScreen).toBe(GROUP);
    expect(result.current.windowTabs.layoutOf(OTHER_GROUP).sides[0]?.up).toBe(
      opened?.id,
    );
    expect(spies.showGroup).not.toHaveBeenCalled();
  });

  it("closes a group the way the sidebar's X does", async () => {
    windowOnTwoSides();
    const answer = await answerTo(
      { group: OTHER_GROUP, kind: "closeGroup" },
      "c1",
    );
    expect(answer).toEqual({ requestId: "c1" });
    expect(spies.closeGroup).toHaveBeenCalledWith(OTHER_GROUP);
  });

  it("closes a tab the way the person's close does", async () => {
    windowOnTwoSides();
    await answerTo({ kind: "close", tabId: OTHER_BEHIND }, "c2");
    expect(spies.closeTab).toHaveBeenCalledWith(OTHER_BEHIND);
  });
});

describe("a link to a tab group or a tab", () => {
  it("brings up the group it names", () => {
    windowOnTwoSides();
    act(() => {
      openLinkAddress(`/tab-groups/${OTHER_GROUP}`);
    });
    expect(spies.showGroup).toHaveBeenCalledWith(OTHER_GROUP);
  });

  it("takes the person to the tab it names", () => {
    const { result } = windowOnTwoSides();
    act(() => {
      openLinkAddress(`/window-tabs/${OTHER_BEHIND}`);
    });
    expect(spies.showGroup).toHaveBeenCalledWith(OTHER_GROUP);
    expect(result.current.windowTabs.layoutOf(OTHER_GROUP).sides[0]?.up).toBe(
      OTHER_BEHIND,
    );
  });

  it("offers to reopen a closed group from the closed list", () => {
    windowOnTwoSides();
    spies.closedEntry.current = "entry_1";
    act(() => {
      openLinkAddress("/tab-groups/group_closed");
    });
    expect(spies.toast).toHaveBeenCalledWith("That tab group is closed", {
      action: { label: "Reopen", onClick: expect.any(Function) },
    });
    const [, options] = spies.toast.mock.calls[0] as [
      string,
      { action: { onClick: () => void } },
    ];
    options.action.onClick();
    expect(spies.reopenClosed).toHaveBeenCalledWith("entry_1");
  });

  it("says a tab no closed list has is gone", () => {
    windowOnTwoSides();
    act(() => {
      openLinkAddress("/window-tabs/tab_gone");
    });
    expect(spies.toast).toHaveBeenCalledWith("That tab is gone", {
      description: "It was closed, and it's no longer in History.",
    });
  });
});

describe("an agent tidying tabs and reading History", () => {
  it("makes a group of tabs it names, and refuses a tab that is not open", async () => {
    windowOnTwoSides();
    expect(
      await answerTo(
        { kind: "groupTabs", tabIds: [OTHER_UP, LEFT_PAGE] },
        "m1",
      ),
    ).toEqual({ group: "group_made", requestId: "m1" });
    expect(spies.groupTabs).toHaveBeenCalledWith([OTHER_UP, LEFT_PAGE]);
    expect(
      await answerTo({ kind: "groupTabs", tabIds: ["tab_gone"] }, "m2"),
    ).toEqual({ error: "no tab tab_gone is open.", requestId: "m2" });
  });

  it("moves tabs into a group", async () => {
    windowOnTwoSides();
    await answerTo(
      { group: OTHER_GROUP, kind: "moveTabs", tabIds: [LEFT_PAGE] },
      "v1",
    );
    expect(spies.moveTabs).toHaveBeenCalledWith([LEFT_PAGE], OTHER_GROUP);
  });

  it("lists a closed group by the id its reopen takes, and reopens it", async () => {
    const { store } = windowOnTwoSides();
    act(() => {
      store.set(appTabsAtom, (current) =>
        closeTabGroup(current, {
          id: TabIdSchema.parse("closed_1"),
          pathname: groupHref("group_old"),
          tabs: [
            {
              group: "group_old",
              href: "/settings/",
              id: "tab_old",
              kind: "screen",
            },
          ],
        }),
      );
    });
    const answer = await answerTo(
      { closedOnly: false, kind: "history", limit: 10 },
      "h1",
    );
    expect(
      (answer as { history?: { id: string; kind: string }[] }).history?.map(
        (row) => [row.kind, row.kind === "visit" ? "" : row.id],
      ),
    ).toEqual([
      ["closedGroup", "closed_1"],
      ["visit", ""],
    ]);
    await answerTo({ entry: "closed_1", kind: "reopenClosed" }, "h2");
    expect(spies.reopenClosed).toHaveBeenCalledWith("closed_1");
    const refused = await answerTo(
      { entry: "closed_nope", kind: "reopenClosed" },
      "h3",
    );
    expect((refused as { error?: string }).error).toContain(
      "nothing in History is closed_nope",
    );
  });
});
