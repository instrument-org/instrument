import { TabIdSchema } from "@/shared/tabs";
import {
  ChatIdSchema,
  StoreId,
  type WindowTabRequest,
} from "@instrument-org/workspace/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider, useSetAtom } from "jotai";
import { type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeTabGroup } from "@/client/lib/tabs-model";

import { appTabsAtom, useAppTabs } from "./app-tabs";
import { type BrowserTabsHandle } from "./browser-tabs";
import { windowTabGroupsAtom } from "./open-groups";
import { type OpenOptions } from "./context";
import { openLinkAddress } from "./open-link-address";
import { useOpeners } from "./use-openers";
import { chatHref, groupHref } from "./window-href";
import {
  useWindowTabs,
  seedWindowTabsAtom,
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
      async *stream(signal: AbortSignal) {
        while (!signal.aborted) {
          const next = waiting.shift();
          if (next) {
            yield next;
          } else {
            await new Promise<void>((resolve) => {
              wake = resolve;
              signal.addEventListener("abort", () => {
                resolve();
              });
            });
          }
        }
      },
    },
    tabDone: vi.fn(async () => {}),
  };
});

const spies = vi.hoisted(() => ({
  closeGroup: vi.fn((_group: string): { isListed: boolean } | undefined => ({
    isListed: true,
  })),
  closeTab: vi.fn((_id: string) => {}),
  groupTabs: vi.fn((_ids: readonly string[]) => "group_made"),
  newGroup: vi.fn(
    (
      _fill: (group: string) => void,
      _options?: { isShownHere?: boolean },
    ): string => "group_a",
  ),
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
        pageBecameDownload: { call: async () => silent() },
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
        events: {
          tab: {
            call: async (_input: undefined, options: { signal: AbortSignal }) =>
              agent.stream(options.signal),
          },
        },
        tabDone: { call: tabDone },
      },
    },
  },
}));

vi.mock("@/client/bookmarks/actions", () => ({
  useAddBookmark: () => () => {},
}));

// Where Files starts is read from the computer's places, which no test here
// asks about.
vi.mock("@/client/hooks/use-files-start-href", () => ({
  useFilesStartHref: () => "/files?path=&root=~",
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
function windowOnTwoSides({
  browser = null,
  isSplit = true,
  newGroup = (fill, options) => spies.newGroup(fill, options),
  up = { href: "/chats", id: CHAT_TAB, kind: "screen" },
}: Partial<Pick<Parameters<typeof useOpeners>[0], "browser" | "newGroup">> & {
  /** Whether the right side is there at all. */
  isSplit?: boolean;
  /** The tab the person is in, on the left. */
  up?:
    | { href: string; id: string; kind: "screen" }
    | { id: string; kind: "page"; openedAt: number };
} = {}) {
  const store = createStore();
  const queryClient = new QueryClient();
  const { result } = renderHook(
    () => {
      const windowTabs = useWindowTabs();
      const appTabs = useAppTabs();
      const openers = useOpeners({
        appsBySlug: new Map(),
        appTabs,
        browser,
        chatTitles: new Map(),
        closedEntryOf: () => spies.closedEntry.current,
        closeGroup: spies.closeGroup,
        closeTab: spies.closeTab,
        groupTabs: spies.groupTabs,
        isOpen: true,
        moveTabs: spies.moveTabs,
        newGroup,
        openChat: () => {},
        reopenClosed: spies.reopenClosed,
        showGroup: spies.showGroup,
        windowTabs,
      });
      return { openers, seed: useSetAtom(seedWindowTabsAtom), windowTabs };
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
    result.current.seed({
      activeByGroup: { [GROUP]: up.id, [OTHER_GROUP]: OTHER_UP },
      ...(isSplit ? { besideByGroup: { [GROUP]: RIGHT_UP } } : {}),
      groups: {},
      tabs: [
        { group: GROUP, ...up },
        { group: GROUP, id: LEFT_PAGE, kind: "page", openedAt: 1 },
        ...(isSplit
          ? [RIGHT_UP, RIGHT_BEHIND].map((id, index) => ({
              group: GROUP,
              id,
              kind: "page" as const,
              openedAt: index + 2,
              side: 1 as const,
            }))
          : []),
        { group: OTHER_GROUP, id: OTHER_UP, kind: "page", openedAt: 4 },
        { group: OTHER_GROUP, id: OTHER_BEHIND, kind: "page", openedAt: 5 },
      ],
    });
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

describe("an agent's asks after one that goes wrong", () => {
  it("are answered though a page never answers the read before them", async () => {
    const browser = {
      readPageText: () => new Promise<never>(() => {}),
    } as Partial<BrowserTabsHandle> as BrowserTabsHandle;
    windowOnTwoSides({ browser });
    agent.ask({
      action: { kind: "read", tabId: RIGHT_UP },
      requestId: "unanswered",
    });
    agent.ask({ action: { kind: "show", tabId: LEFT_PAGE }, requestId: "r3" });
    await waitFor(
      () => {
        expect(tabDone).toHaveBeenCalledWith({
          requestId: "r3",
          tabId: LEFT_PAGE,
        });
      },
      { timeout: 3000 },
    );
  });

  it("are answered though the one before them threw, which says so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const browser = {
      readPageText: () => Promise.reject(new Error("no page")),
    } as Partial<BrowserTabsHandle> as BrowserTabsHandle;
    windowOnTwoSides({ browser });
    agent.ask({ action: { kind: "read", tabId: RIGHT_UP }, requestId: "r4" });
    agent.ask({ action: { kind: "show", tabId: LEFT_PAGE }, requestId: "r5" });
    await waitFor(() => {
      expect(tabDone).toHaveBeenCalledWith({
        requestId: "r5",
        tabId: LEFT_PAGE,
      });
    });
    expect(tabDone).toHaveBeenCalledWith({
      error: "the window could not do that.",
      requestId: "r4",
    });
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
    expect(answer).toEqual({ isListed: true, requestId: "c1" });
    expect(spies.closeGroup).toHaveBeenCalledWith(OTHER_GROUP);
  });

  it("says when a group it closed stayed off the closed list", async () => {
    windowOnTwoSides();
    spies.closeGroup.mockReturnValueOnce({ isListed: false });
    const answer = await answerTo(
      { group: OTHER_GROUP, kind: "closeGroup" },
      "c3",
    );
    expect(answer).toEqual({ isListed: false, requestId: "c3" });
  });

  it("closes a tab the way the person's close does", async () => {
    windowOnTwoSides();
    await answerTo({ kind: "close", tabId: OTHER_BEHIND }, "c2");
    expect(spies.closeTab).toHaveBeenCalledWith(OTHER_BEHIND);
  });
});

describe("an address no screen answers", () => {
  it.each([
    ["a page a later build removed", "/removed-page?from=older-build", {}],
    ["one asked for in a tab of its own", "/removed-page", { newTab: true }],
    [
      "a task's address that names no session",
      "/tasks/not-a-session?chat=2026-10-01-roofer",
      {},
    ],
  ])(
    "opens %s as a tab of the group up, the window staying on the group",
    (_case, href, options) => {
      const { result, store } = windowOnTwoSides();
      act(() => {
        result.current.openers.openScreen(href, options);
      });
      const opened = store
        .get(windowTabsAtom)
        .tabs.filter((tab) => tab.kind === "screen" && tab.href === href);
      expect(opened).toEqual([expect.objectContaining({ group: GROUP })]);
      expect(store.get(appTabsAtom).tabs.map((tab) => tab.pathname)).toEqual([
        groupHref(GROUP),
      ]);
    },
  );
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

describe("a bookmark opened in a new tab", () => {
  it.each([
    ["behind", true],
    ["in front", false],
  ])("is last on its side, %s", (_case, behind) => {
    const { result, store } = windowOnTwoSides();
    act(() => {
      result.current.openers.openScreen("/apps/github", {
        atEnd: true,
        behind,
        newTab: true,
      });
    });
    const { activeByGroup, openers, tabs } = store.get(windowTabsAtom);
    const left = tabs.filter((tab) => tab.group === GROUP && tab.side !== 1);
    const opened = left.at(-1);
    expect(left).toHaveLength(3);
    expect(opened).toMatchObject({ href: "/apps/github" });
    expect(activeByGroup[GROUP] === opened?.id).toBe(!behind);
    expect(openers).toEqual({ openers: {}, sources: {} });
  });

  it("is last for a site too", () => {
    const open = vi.fn(() => StoreId.newTabId());
    // Only `open` is reached here; the rest of the handle is the mounted browser's.
    const browser = { open } as unknown as BrowserTabsHandle;
    const { result } = windowOnTwoSides({ browser });
    act(() => {
      result.current.openers.openPage("https://a.example/", {
        atEnd: true,
        behind: true,
        from: LEFT_PAGE,
        newTab: true,
      });
    });
    expect(open).toHaveBeenCalledWith("https://a.example/", {
      behind: true,
      group: GROUP,
    });
  });
});

describe("Open in New Tab Group", () => {
  const windowMaking = () => {
    const newGroup = vi.fn<Parameters<typeof useOpeners>[0]["newGroup"]>(
      () => "group_new",
    );
    return { ...windowOnTwoSides({ newGroup }), newGroup };
  };
  it.each([
    ["under the group it was asked from", { from: LEFT_PAGE }, false, true],
    ["at the top from a pinned group", { from: LEFT_PAGE }, true, false],
    ["at the top from no tab", {}, false, false],
  ])("is %s", (_case, asked, pinned, isUnder) => {
    const { newGroup, result } = windowMaking();
    act(() => {
      result.current.windowTabs.setGroupOwn(GROUP, {
        pinned: pinned ? true : undefined,
      });
    });
    act(() => {
      result.current.openers.openPage("https://a.example/", {
        ...asked,
        into: "group",
      });
    });
    expect(newGroup.mock.calls[0]?.[1]).toEqual({
      returns: "untilUnrelated",
      ...(isUnder ? { place: { after: GROUP } } : {}),
    });
  });
});

describe("opening a bookmark folder's bookmarks together", () => {
  const NEW_GROUP = "group_new";
  /** A window whose new groups are filled at once, and whose browser says each page it opens. */
  function windowOpeningAll() {
    const opened: string[] = [];
    const made: ({ isShownHere?: boolean } | undefined)[] = [];
    // Each page's tab by its address, which the next one is said to follow.
    const pages = new Map<string, string>();
    const open: BrowserTabsHandle["open"] = (url = "", options) => {
      const id = StoreId.newTabId();
      const after =
        options?.after === undefined
          ? "nothing"
          : (pages.get(options.after) ?? options.after);
      opened.push(
        `page ${url} in ${options?.group ?? "?"} after ${after}${options?.show === true ? ", up" : ""}`,
      );
      pages.set(id, url);
      return id;
    };
    const { result, store } = windowOnTwoSides({
      // Only `open` is reached by what these open; the rest of the handle
      // is the mounted browser's, which no test here draws.
      browser: { open } as unknown as BrowserTabsHandle,
      newGroup: (fill, options) => {
        made.push(options);
        fill(NEW_GROUP);
        return NEW_GROUP;
      },
    });
    return { made, opened, result, store };
  }

  it("opens each right after the one before, in one new group, the first up", () => {
    const { made, opened, result, store } = windowOpeningAll();
    act(() => {
      result.current.openers.openAll(
        [
          { kind: "page", url: "https://a.example/" },
          { href: "/apps/github", kind: "screen" },
          // A group is no tab's, so it is left out.
          { href: groupHref(OTHER_GROUP), kind: "screen" },
          { kind: "page", url: "https://b.example/" },
        ],
        "group",
      );
    });
    const app = store
      .get(windowTabsAtom)
      .tabs.find((tab) => tab.group === NEW_GROUP);
    const { id, ...rest } = app ?? { id: "none" };
    expect({
      app: rest,
      made,
      opened: opened.map((line) => line.replace(id, "the app's tab")),
    }).toMatchInlineSnapshot(`
      {
        "app": {
          "group": "group_new",
          "href": "/apps/github",
          "kind": "screen",
        },
        "made": [
          {
            "returns": "untilUnrelated",
          },
        ],
        "opened": [
          "page https://a.example/ in group_new after nothing, up",
          "page https://b.example/ in group_new after the app's tab",
        ],
      }
    `);
    expect(spies.showGroup).not.toHaveBeenCalledWith(NEW_GROUP, {
      newWindow: true,
    });
  });

  it("makes the group for a window of its own in New Window", () => {
    const { made, result } = windowOpeningAll();
    act(() => {
      result.current.openers.openAll(
        [{ kind: "page", url: "https://a.example/" }],
        "window",
      );
    });
    expect(made).toEqual([{ isShownHere: false }]);
    expect(spies.showGroup).toHaveBeenCalledWith(NEW_GROUP, {
      newWindow: true,
    });
  });

  it("makes no group where nothing can stand in one", () => {
    const { made, result } = windowOpeningAll();
    act(() => {
      result.current.openers.openAll(
        [{ href: groupHref(OTHER_GROUP), kind: "screen" }],
        "group",
      );
    });
    expect(made).toEqual([]);
  });
});

/**
 * Every gesture on every kind of thing, from each kind of tab a person can be
 * in, as one table: a rule that differs by kind shows as a row that reads
 * differently from its neighbors.
 */
describe("where each gesture opens each kind of thing", () => {
  const CHAT = ChatIdSchema.parse("2026-11-14-renewals");
  const NEW_GROUP = "group_new";
  const GESTURES: [string, OpenOptions][] = [
    ["click", {}],
    ["Cmd-click", { behind: true, newTab: true }],
    ["Open in New Tab", { newTab: true }],
    ["built-in page", { newTab: "reuseBlank" }],
    ["Shift-click", { newWindow: true }],
    ["tab of its own", { ownTab: true }],
    ["other group", { group: OTHER_GROUP }],
    ["other group, new tab", { group: OTHER_GROUP, newTab: true }],
    ["Open in Split", { into: "split" }],
    ["New Tab Group", { into: "group" }],
    ["New Window", { into: "window" }],
  ];
  const STANDING: [string, Parameters<typeof windowOnTwoSides>[0]][] = [
    ["New Tab", { isSplit: false }],
    ["New Tab in a split", {}],
    ["a screen", { up: { href: "/activity", id: CHAT_TAB, kind: "screen" } }],
    ["a page", { up: { id: CHAT_TAB, kind: "page", openedAt: 1 } }],
  ];
  const SCREENS: [string, string][] = [
    ["settings", "/settings"],
    ["app", "/apps/github"],
    ["chat", chatHref(CHAT)],
  ];

  function landed(
    href: string,
    standing: (typeof STANDING)[number][1],
    asked: OpenOptions,
  ) {
    spies.newGroup.mockImplementation((fill) => {
      fill(NEW_GROUP);
      return NEW_GROUP;
    });
    const { result, store } = windowOnTwoSides(standing);
    const before = new Set(store.get(windowTabsAtom).tabs.map((tab) => tab.id));
    act(() => {
      result.current.openers.openScreen(href, asked);
    });
    const { tabs } = store.get(windowTabsAtom);
    const tab = tabs.find(
      (each) => each.kind === "screen" && each.href === href,
    );
    if (tab?.group === undefined) {
      return "nowhere";
    }
    const { group, id } = tab;
    const layout = result.current.windowTabs.layoutOf(group);
    const side = layout.sides.findIndex(({ tabs: inSide }) =>
      inSide.some((each) => each.id === id),
    );
    const isUp = layout.sides[side]?.up === id;
    const isInPlace =
      before.has(id) || !tabs.some((each) => each.id === CHAT_TAB);
    return [
      group === GROUP ? "here" : group,
      side === 0 ? "left" : "right",
      isInPlace ? "in place" : "new tab",
      isUp ? "up" : "behind",
      ...(isUp && layout.focused === side ? ["keyboard"] : []),
    ].join(", ");
  }

  it("a screen, an app and a chat", () => {
    const table = SCREENS.flatMap(([kind, href]) =>
      GESTURES.flatMap(([gesture, asked]) =>
        STANDING.map(
          ([from, standing]) =>
            `${kind} | ${gesture} | ${from} | ${landed(href, standing, asked)}`,
        ),
      ),
    );
    expect(`\n${table.join("\n")}\n`).toMatchInlineSnapshot(`
      "
      settings | click | New Tab | here, left, in place, up, keyboard
      settings | click | New Tab in a split | here, left, in place, up, keyboard
      settings | click | a screen | here, left, in place, up, keyboard
      settings | click | a page | here, left, in place, up, keyboard
      settings | Cmd-click | New Tab | here, left, new tab, behind
      settings | Cmd-click | New Tab in a split | here, left, new tab, behind
      settings | Cmd-click | a screen | here, left, new tab, behind
      settings | Cmd-click | a page | here, left, new tab, behind
      settings | Open in New Tab | New Tab | here, left, new tab, up, keyboard
      settings | Open in New Tab | New Tab in a split | here, left, new tab, up, keyboard
      settings | Open in New Tab | a screen | here, left, new tab, up, keyboard
      settings | Open in New Tab | a page | here, left, new tab, up, keyboard
      settings | built-in page | New Tab | here, left, in place, up, keyboard
      settings | built-in page | New Tab in a split | here, left, new tab, up, keyboard
      settings | built-in page | a screen | here, left, new tab, up, keyboard
      settings | built-in page | a page | here, left, new tab, up, keyboard
      settings | Shift-click | New Tab | here, left, new tab, up, keyboard
      settings | Shift-click | New Tab in a split | here, left, new tab, up, keyboard
      settings | Shift-click | a screen | here, left, new tab, up, keyboard
      settings | Shift-click | a page | here, left, new tab, up, keyboard
      settings | tab of its own | New Tab | here, left, in place, up, keyboard
      settings | tab of its own | New Tab in a split | here, left, new tab, up, keyboard
      settings | tab of its own | a screen | here, left, new tab, up, keyboard
      settings | tab of its own | a page | here, left, new tab, up, keyboard
      settings | other group | New Tab | group_b, left, new tab, behind
      settings | other group | New Tab in a split | group_b, left, new tab, behind
      settings | other group | a screen | group_b, left, new tab, behind
      settings | other group | a page | group_b, left, new tab, behind
      settings | other group, new tab | New Tab | group_b, left, new tab, up, keyboard
      settings | other group, new tab | New Tab in a split | group_b, left, new tab, up, keyboard
      settings | other group, new tab | a screen | group_b, left, new tab, up, keyboard
      settings | other group, new tab | a page | group_b, left, new tab, up, keyboard
      settings | Open in Split | New Tab | here, right, new tab, up, keyboard
      settings | Open in Split | New Tab in a split | here, right, new tab, up, keyboard
      settings | Open in Split | a screen | here, right, new tab, up, keyboard
      settings | Open in Split | a page | here, right, new tab, up, keyboard
      settings | New Tab Group | New Tab | group_new, left, new tab, up, keyboard
      settings | New Tab Group | New Tab in a split | group_new, left, new tab, up, keyboard
      settings | New Tab Group | a screen | group_new, left, new tab, up, keyboard
      settings | New Tab Group | a page | group_new, left, new tab, up, keyboard
      settings | New Window | New Tab | group_new, left, new tab, up, keyboard
      settings | New Window | New Tab in a split | group_new, left, new tab, up, keyboard
      settings | New Window | a screen | group_new, left, new tab, up, keyboard
      settings | New Window | a page | group_new, left, new tab, up, keyboard
      app | click | New Tab | here, left, in place, up, keyboard
      app | click | New Tab in a split | here, left, new tab, up, keyboard
      app | click | a screen | here, left, new tab, up, keyboard
      app | click | a page | here, left, new tab, up, keyboard
      app | Cmd-click | New Tab | here, left, new tab, behind
      app | Cmd-click | New Tab in a split | here, left, new tab, behind
      app | Cmd-click | a screen | here, left, new tab, behind
      app | Cmd-click | a page | here, left, new tab, behind
      app | Open in New Tab | New Tab | here, left, new tab, up, keyboard
      app | Open in New Tab | New Tab in a split | here, left, new tab, up, keyboard
      app | Open in New Tab | a screen | here, left, new tab, up, keyboard
      app | Open in New Tab | a page | here, left, new tab, up, keyboard
      app | built-in page | New Tab | here, left, in place, up, keyboard
      app | built-in page | New Tab in a split | here, left, new tab, up, keyboard
      app | built-in page | a screen | here, left, new tab, up, keyboard
      app | built-in page | a page | here, left, new tab, up, keyboard
      app | Shift-click | New Tab | here, left, new tab, up, keyboard
      app | Shift-click | New Tab in a split | here, left, new tab, up, keyboard
      app | Shift-click | a screen | here, left, new tab, up, keyboard
      app | Shift-click | a page | here, left, new tab, up, keyboard
      app | tab of its own | New Tab | here, left, in place, up, keyboard
      app | tab of its own | New Tab in a split | here, left, new tab, up, keyboard
      app | tab of its own | a screen | here, left, new tab, up, keyboard
      app | tab of its own | a page | here, left, new tab, up, keyboard
      app | other group | New Tab | here, left, in place, up, keyboard
      app | other group | New Tab in a split | here, left, new tab, up, keyboard
      app | other group | a screen | here, left, new tab, up, keyboard
      app | other group | a page | here, left, new tab, up, keyboard
      app | other group, new tab | New Tab | group_b, left, new tab, up, keyboard
      app | other group, new tab | New Tab in a split | group_b, left, new tab, up, keyboard
      app | other group, new tab | a screen | group_b, left, new tab, up, keyboard
      app | other group, new tab | a page | group_b, left, new tab, up, keyboard
      app | Open in Split | New Tab | here, right, new tab, up, keyboard
      app | Open in Split | New Tab in a split | here, right, new tab, up, keyboard
      app | Open in Split | a screen | here, right, new tab, up, keyboard
      app | Open in Split | a page | here, right, new tab, up, keyboard
      app | New Tab Group | New Tab | group_new, left, new tab, up, keyboard
      app | New Tab Group | New Tab in a split | group_new, left, new tab, up, keyboard
      app | New Tab Group | a screen | group_new, left, new tab, up, keyboard
      app | New Tab Group | a page | group_new, left, new tab, up, keyboard
      app | New Window | New Tab | group_new, left, new tab, up, keyboard
      app | New Window | New Tab in a split | group_new, left, new tab, up, keyboard
      app | New Window | a screen | group_new, left, new tab, up, keyboard
      app | New Window | a page | group_new, left, new tab, up, keyboard
      chat | click | New Tab | here, left, in place, up, keyboard
      chat | click | New Tab in a split | here, left, new tab, up, keyboard
      chat | click | a screen | here, left, new tab, up, keyboard
      chat | click | a page | here, left, new tab, up, keyboard
      chat | Cmd-click | New Tab | here, left, new tab, behind
      chat | Cmd-click | New Tab in a split | here, left, new tab, behind
      chat | Cmd-click | a screen | here, left, new tab, behind
      chat | Cmd-click | a page | here, left, new tab, behind
      chat | Open in New Tab | New Tab | here, left, new tab, up, keyboard
      chat | Open in New Tab | New Tab in a split | here, left, new tab, up, keyboard
      chat | Open in New Tab | a screen | here, left, new tab, up, keyboard
      chat | Open in New Tab | a page | here, left, new tab, up, keyboard
      chat | built-in page | New Tab | here, left, in place, up, keyboard
      chat | built-in page | New Tab in a split | here, left, new tab, up, keyboard
      chat | built-in page | a screen | here, left, new tab, up, keyboard
      chat | built-in page | a page | here, left, new tab, up, keyboard
      chat | Shift-click | New Tab | here, left, new tab, up, keyboard
      chat | Shift-click | New Tab in a split | here, left, new tab, up, keyboard
      chat | Shift-click | a screen | here, left, new tab, up, keyboard
      chat | Shift-click | a page | here, left, new tab, up, keyboard
      chat | tab of its own | New Tab | here, left, in place, up, keyboard
      chat | tab of its own | New Tab in a split | here, left, new tab, up, keyboard
      chat | tab of its own | a screen | here, left, new tab, up, keyboard
      chat | tab of its own | a page | here, left, new tab, up, keyboard
      chat | other group | New Tab | here, left, in place, up, keyboard
      chat | other group | New Tab in a split | here, left, new tab, up, keyboard
      chat | other group | a screen | here, left, new tab, up, keyboard
      chat | other group | a page | here, left, new tab, up, keyboard
      chat | other group, new tab | New Tab | here, left, new tab, up, keyboard
      chat | other group, new tab | New Tab in a split | here, left, new tab, up, keyboard
      chat | other group, new tab | a screen | here, left, new tab, up, keyboard
      chat | other group, new tab | a page | here, left, new tab, up, keyboard
      chat | Open in Split | New Tab | here, right, new tab, up, keyboard
      chat | Open in Split | New Tab in a split | here, right, new tab, up, keyboard
      chat | Open in Split | a screen | here, right, new tab, up, keyboard
      chat | Open in Split | a page | here, right, new tab, up, keyboard
      chat | New Tab Group | New Tab | group_new, left, new tab, up, keyboard
      chat | New Tab Group | New Tab in a split | group_new, left, new tab, up, keyboard
      chat | New Tab Group | a screen | group_new, left, new tab, up, keyboard
      chat | New Tab Group | a page | group_new, left, new tab, up, keyboard
      chat | New Window | New Tab | group_new, left, new tab, up, keyboard
      chat | New Window | New Tab in a split | group_new, left, new tab, up, keyboard
      chat | New Window | a screen | group_new, left, new tab, up, keyboard
      chat | New Window | a page | group_new, left, new tab, up, keyboard
      "
    `);
  });

  it("a page, as the browser is asked for it", () => {
    const table = GESTURES.flatMap(([gesture, asked]) =>
      STANDING.map(([from, standing]) => {
        spies.newGroup.mockImplementation((fill) => {
          fill(NEW_GROUP);
          return NEW_GROUP;
        });
        const asks: string[] = [];
        const say = (name: string) => (_url?: string, options?: object) => {
          asks.push(
            `${name} ${JSON.stringify(options ?? {}, (key, value: unknown) => (key === "replacing" ? "the tab up" : value))}`,
          );
          return StoreId.newTabId();
        };
        const { result } = windowOnTwoSides({
          ...standing,
          // Only what an open asks of the browser.
          browser: {
            navigate: say("navigate"),
            open: say("open"),
            openOrFocus: say("openOrFocus"),
          } as unknown as BrowserTabsHandle,
        });
        act(() => {
          result.current.openers.openPage("https://example.com/", asked);
        });
        return `${gesture} | ${from} | ${asks.join("; ")}`;
      }),
    );
    expect(`\n${table.join("\n")}\n`).toMatchInlineSnapshot(`
      "
      click | New Tab | open {"replacing":"the tab up"}
      click | New Tab in a split | open {"replacing":"the tab up"}
      click | a screen | open {"replacing":"the tab up"}
      click | a page | navigate {}
      Cmd-click | New Tab | open {"behind":true,"newTab":true}
      Cmd-click | New Tab in a split | open {"behind":true,"newTab":true}
      Cmd-click | a screen | open {"behind":true,"newTab":true}
      Cmd-click | a page | open {"behind":true,"newTab":true}
      Open in New Tab | New Tab | open {"behind":false,"newTab":true}
      Open in New Tab | New Tab in a split | open {"behind":false,"newTab":true}
      Open in New Tab | a screen | open {"behind":false,"newTab":true}
      Open in New Tab | a page | open {"behind":false,"newTab":true}
      built-in page | New Tab | open {"replacing":"the tab up"}
      built-in page | New Tab in a split | open {"behind":false,"newTab":true}
      built-in page | a screen | open {"behind":false,"newTab":true}
      built-in page | a page | open {"behind":false,"newTab":true}
      Shift-click | New Tab | open {"behind":false,"newTab":true}
      Shift-click | New Tab in a split | open {"behind":false,"newTab":true}
      Shift-click | a screen | open {"behind":false,"newTab":true}
      Shift-click | a page | open {"behind":false,"newTab":true}
      tab of its own | New Tab | open {"replacing":"the tab up"}
      tab of its own | New Tab in a split | openOrFocus {}
      tab of its own | a screen | openOrFocus {}
      tab of its own | a page | openOrFocus {}
      other group | New Tab | openOrFocus {"group":"group_b","show":false}
      other group | New Tab in a split | openOrFocus {"group":"group_b","show":false}
      other group | a screen | openOrFocus {"group":"group_b","show":false}
      other group | a page | openOrFocus {"group":"group_b","show":false}
      other group, new tab | New Tab | openOrFocus {"group":"group_b","show":false}
      other group, new tab | New Tab in a split | openOrFocus {"group":"group_b","show":false}
      other group, new tab | a screen | openOrFocus {"group":"group_b","show":false}
      other group, new tab | a page | openOrFocus {"group":"group_b","show":false}
      Open in Split | New Tab | open {"group":"group_a","side":1,"show":true}
      Open in Split | New Tab in a split | open {"after":"tab_right_up","group":"group_a","side":1,"show":true}
      Open in Split | a screen | open {"after":"tab_right_up","group":"group_a","side":1,"show":true}
      Open in Split | a page | open {"after":"tab_right_up","group":"group_a","side":1,"show":true}
      New Tab Group | New Tab | open {"group":"group_new","show":true}
      New Tab Group | New Tab in a split | open {"group":"group_new","show":true}
      New Tab Group | a screen | open {"group":"group_new","show":true}
      New Tab Group | a page | open {"group":"group_new","show":true}
      New Window | New Tab | open {"group":"group_new","show":true}
      New Window | New Tab in a split | open {"group":"group_new","show":true}
      New Window | a screen | open {"group":"group_new","show":true}
      New Window | a page | open {"group":"group_new","show":true}
      "
    `);
  });
});

describe("a setting clicked in a chat", () => {
  const CHAT = ChatIdSchema.parse("2026-11-24-grok");
  const LINK = "/settings/grok-account";
  const ROW = "/settings/providers?setting=grok-account";
  const asked = { chat: CHAT, from: CHAT_TAB, ownTab: true, show: true };
  const inChat = {
    up: { href: `/chats/${CHAT}`, id: CHAT_TAB, kind: "screen" as const },
  };
  const screens = (tabs: { href?: string; side?: 0 | 1 }[]) =>
    tabs
      .filter((tab) => tab.href?.startsWith("/settings"))
      .map((tab) => [tab.href, tab.side ?? 0]);

  it("opens on the right of a chat on the left, leaving Settings in another group where it is", () => {
    const { result, store } = windowOnTwoSides(inChat);
    act(() => {
      result.current.windowTabs.openIn(
        {
          group: OTHER_GROUP,
          href: "/settings/general",
          id: "tab_settings",
          kind: "screen",
        },
        { group: OTHER_GROUP },
      );
    });
    act(() => {
      result.current.openers.openScreen(LINK, asked);
    });
    const { tabs } = store.get(windowTabsAtom);
    expect(screens(tabs.filter((tab) => tab.group === GROUP))).toEqual([
      [ROW, 1],
    ]);
    expect(screens(tabs.filter((tab) => tab.group === OTHER_GROUP))).toEqual([
      ["/settings/general", 0],
    ]);
  });

  it("walks Settings already on the right to the row", () => {
    const { result, store } = windowOnTwoSides(inChat);
    act(() => {
      result.current.openers.openScreen("/settings/general", asked);
    });
    act(() => {
      result.current.openers.openScreen(LINK, asked);
    });
    expect(screens(store.get(windowTabsAtom).tabs)).toEqual([[ROW, 1]]);
  });

  it("opens right after a chat on the right, in its side", () => {
    const { result, store } = windowOnTwoSides(inChat);
    act(() => {
      result.current.windowTabs.moveTo({
        group: GROUP,
        id: CHAT_TAB,
        index: 0,
        side: 1,
      });
    });
    act(() => {
      result.current.openers.openScreen(LINK, asked);
    });
    const right = result.current.windowTabs.layoutOf(GROUP).sides[1]?.tabs;
    expect(right?.map((tab) => tab.id === CHAT_TAB).indexOf(true)).toBe(0);
    expect(right?.[1]).toMatchObject({ href: ROW });
    expect(screens(store.get(windowTabsAtom).tabs)).toEqual([[ROW, 1]]);
  });

  it("opens behind on a Command-click", () => {
    const { result, store } = windowOnTwoSides(inChat);
    act(() => {
      result.current.openers.openScreen(LINK, {
        ...asked,
        behind: true,
        newTab: true,
        show: false,
      });
    });
    expect(screens(store.get(windowTabsAtom).tabs)).toEqual([[ROW, 0]]);
    expect(result.current.windowTabs.active?.id).toBe(CHAT_TAB);
  });
});

describe("an open asked beside a group's tab", () => {
  const APPS_TAB = "tab_apps";
  const up = { href: "/apps", id: APPS_TAB, kind: "screen" as const };

  it("hands a page to the browser beside the tab, as a click in a chat does", () => {
    const openBeside = vi.fn(() => ({
      front: true,
      id: StoreId.newTabId(),
    }));
    const { result } = windowOnTwoSides({
      browser: {
        openBeside,
      } as Partial<BrowserTabsHandle> as BrowserTabsHandle,
      isSplit: false,
      up,
    });
    act(() => {
      result.current.openers.openPage("https://keys.example/", {
        beside: APPS_TAB,
      });
    });
    expect(openBeside).toHaveBeenCalledWith("https://keys.example/", {
      chatTab: APPS_TAB,
      gesture: "click",
    });
  });

  it("makes the right side for a screen when the group has one", () => {
    const { result } = windowOnTwoSides({ isSplit: false, up });
    act(() => {
      result.current.openers.openScreen("/settings/general", {
        beside: APPS_TAB,
      });
    });
    expect(
      result.current.windowTabs
        .layoutOf(GROUP)
        .sides.map((side) =>
          side.tabs.map((tab) => (tab.kind === "screen" ? tab.href : tab.id)),
        ),
    ).toEqual([["/apps", LEFT_PAGE], ["/settings/general"]]);
  });
});
