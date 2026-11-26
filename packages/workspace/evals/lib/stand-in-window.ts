/**
 * A window for a run that has none: the tabs a case says the user had open,
 * answering the conversation's `instrument window` commands the way the app's window does.
 *
 * What it stands in for is the window's bookkeeping, not its pages. A tab id
 * the conversation reads in the note resolves here, `instrument window show <url>` makes a
 * new id and puts it in front, `close` and `show --in` act on the list, and a page tab reads as a live target
 * so the bridge lists it as the chat's. A task still browses in a Chrome
 * of its own (the run has no guests), so a case scores what the conversation
 * decided, not what a task saw in the tab. Given a shared Chrome
 * (`sharedBrowser`), each page tab is a real page there instead, which every
 * session of the chat reaches through the bridge and `read` reads.
 */
import { pageTextOf, READ_PAGE_TEXT } from "@instrument-org/shared/page-text";

import { type BookmarkSide } from "../../src/schemas/bookmark-change";
import { publisher } from "../../src/rpc/publisher";
import {
  type LayoutRead,
  type LayoutSnapshot,
  type LayoutTab,
} from "../../src/schemas/group-layout";
import { AbsolutePathSchema } from "../../src/schemas/paths";
import { type SessionMessageDataPart } from "../../src/schemas/session/message-data-part";
import { StoreId } from "../../src/schemas/store-id";
import {
  type WindowTabAction,
  type WindowTabAnswer,
  type WindowTabTarget,
} from "../../src/schemas/window-tab";
import {
  type BrowserConfig,
  browserTargetOf,
  parseBrowserTargetId,
} from "../../src/types";
import { type SharedChrome } from "./shared-chrome";

export type ListedBookmark = NonNullable<WindowTabAnswer["bookmarks"]>[number];

/** The group of the window `window new` opens. */
const NEW_WINDOW_GROUP = "group:stand-in-new-window";

export interface StandInTab {
  at: string;
  id: string;
  kind: "page" | "screen";
}

/**
 * The group a new chat starts in, in the app: the chat alone, up on the one
 * side, with the keyboard. A page the chat opens then lands beside it, as
 * `placed` does.
 */
const CHAT_ALONE: LayoutSnapshot = {
  focused: 0,
  group: { id: "group_stand_in" },
  sides: [
    {
      tabs: [
        {
          address: "instrument://chat/this-chat",
          id: "this-chat",
          isThisChat: true,
          isUp: true,
          kind: "chat",
          title: "New chat",
        },
      ],
    },
  ],
};

export function createStandInWindow(chrome?: SharedChrome) {
  const tabs = new Map<string, StandInTab>();
  /** The tab in front: the last one opened, shown or moved in. */
  let front: string | undefined;
  /** The case's tab group, where a page the chat opens lands as the app places it (`placed`). */
  let layout: LayoutSnapshot | undefined;
  /** The chat's last page in the group, which its next one goes right after. */
  let previous: string | undefined;

  /** The case's bookmarks and folders, as a list answers them. */
  let bookmarks: ListedBookmark[] = [];

  /** A bookmark as a change has it, every one sorting alike. */
  const sideOfBookmark = (id: string): BookmarkSide | null => {
    const found = bookmarks.find((each) => each.id === id);
    if (!found) {
      return null;
    }
    const { folder, kind, root, title, url } = found;
    const inFolder = bookmarks.find(
      (each) =>
        each.kind === "folder" && each.root === root && each.title === folder,
    );
    return {
      kind,
      order: 0,
      place: `${root === "all" ? "All Bookmarks" : "Bookmarks bar"}${folder === undefined ? "" : `/${folder}`}`,
      root,
      title,
      ...(url === undefined ? {} : { url }),
      ...(inFolder ? { folder: inFolder.id } : {}),
    };
  };

  /** Makes a change to the bookmarks, but for their order within a place, which no case scores. */
  const changeBookmarks = (
    change: Extract<WindowTabAction, { kind: "changeBookmarks" }>["change"],
  ): Omit<WindowTabAnswer, "requestId"> => {
    const before = new Map(
      bookmarks.map(({ id }) => [id, sideOfBookmark(id)] as const),
    );
    if (change.type === "newFolder") {
      bookmarks.push({
        id: crypto.randomUUID(),
        kind: "folder",
        root: change.root,
        title: change.title,
      });
    } else if (change.type === "remove") {
      const gone = bookmarks.filter((each) => change.ids.includes(each.id));
      bookmarks = bookmarks.filter(
        (each) =>
          !gone.some(
            (one) =>
              one.id === each.id ||
              (one.kind === "folder" &&
                one.root === each.root &&
                one.title === each.folder),
          ),
      );
    } else if (change.type === "move") {
      const beside = bookmarks.find(
        (each) => each.id === (change.before ?? change.after),
      );
      const into = bookmarks.find((each) => each.id === change.to);
      for (const each of bookmarks) {
        if (!change.ids.includes(each.id) || each.kind === "folder") {
          continue;
        }
        delete each.folder;
        if (change.to === "all" || change.to === "bar") {
          each.root = change.to;
        } else if (into) {
          each.root = into.root;
          each.folder = into.title;
        } else if (beside) {
          each.root = beside.root;
          if (beside.folder !== undefined) {
            each.folder = beside.folder;
          }
        }
      }
    } else {
      const one = bookmarks.find((each) => each.id === change.id);
      if (one && change.type === "rename") {
        for (const each of bookmarks) {
          if (
            one.kind === "folder" &&
            each.root === one.root &&
            each.folder === one.title
          ) {
            each.folder = change.title;
          }
        }
        one.title = change.title;
      } else if (one && change.type === "setUrl") {
        one.url = change.url;
      }
    }
    const ids = new Set([
      ...before.keys(),
      ...bookmarks.map((each) => each.id),
    ]);
    return {
      bookmarkChanges: [...ids].flatMap((id) => {
        const was = before.get(id) ?? null;
        const is = sideOfBookmark(id);
        return JSON.stringify(was) === JSON.stringify(is)
          ? []
          : [{ after: is, before: was, id }];
      }),
    };
  };

  /** The tabs `window new` took to a window of their own. */
  const apart = new Map<string, StandInTab>();

  /** A list's answer, with the window `window new` opened behind the case's own, once there is one. */
  const withApart = (
    answer: Omit<WindowTabAnswer, "requestId">,
  ): Omit<WindowTabAnswer, "requestId"> => {
    const own = answer.read?.layout;
    if (apart.size === 0 || !own) {
      return answer;
    }
    return {
      ...answer,
      windows: [
        // A stand-in group goes by its id, as a list names one it has no row for.
        { groups: [{ ...own, name: own.group.id }], isThisWindow: true },
        {
          groups: [
            {
              focused: 0,
              group: { id: NEW_WINDOW_GROUP },
              name: NEW_WINDOW_GROUP,
              sides: [
                {
                  tabs: [...apart.values()].map((tab, at) => ({
                    address: tab.at,
                    id: tab.id,
                    ...(at === 0 && { isUp: true }),
                    kind:
                      tab.kind === "page"
                        ? ("website" as const)
                        : ("builtIn" as const),
                    title: "",
                  })),
                },
              ],
            },
          ],
        },
      ],
    };
  };

  const sideOf = (id: string) =>
    layout?.sides.findIndex((side) => side.tabs.some((tab) => tab.id === id));

  /** Puts a tab up on its side, the one there before going behind it. */
  const raise = (id: string) => {
    const side = layout?.sides[sideOf(id) ?? -1];
    for (const tab of side?.tabs ?? []) {
      tab.isUp = tab.id === id;
    }
  };

  /**
   * A page the chat opens, placed against the chat's tab as the app's
   * `besidePlacementOf` does: after the chat's last page; else, with the
   * chat on the right, right after it on its side, up only when shown; else
   * on the right side, made when there is none, up unless the keyboard is
   * there. Answers whether it waits behind.
   */
  const placed = (tab: StandInTab, show: boolean): boolean => {
    if (!layout) {
      return false;
    }
    const entry: LayoutTab = {
      address: tab.at,
      byAgent: true,
      id: tab.id,
      kind: tab.kind === "page" ? "website" : "file",
      title: tab.at,
    };
    const chatSide =
      layout.sides.findIndex((side) =>
        side.tabs.some((each) => each.isThisChat),
      ) === 1
        ? 1
        : 0;
    const after =
      previous !== undefined && (sideOf(previous) ?? -1) >= chatSide
        ? previous
        : chatSide === 1
          ? layout.sides[1]?.tabs.find((each) => each.isThisChat)?.id
          : layout.sides[1]?.tabs.at(-1)?.id;
    if (layout.sides.length === 1) {
      layout.sides.push({ tabs: [] });
    }
    const side = after === undefined ? 1 : (sideOf(after) ?? 1);
    const strip = layout.sides[side]?.tabs ?? [];
    const at =
      after === undefined
        ? strip.length
        : strip.findIndex((each) => each.id === after) + 1;
    strip.splice(at, 0, entry);
    previous = tab.id;
    const isFront = side === chatSide ? show : layout.focused !== side;
    if (isFront || strip.length === 1) {
      raise(tab.id);
    }
    return !entry.isUp;
  };

  const add = (target: WindowTabTarget): StandInTab => {
    const tab: StandInTab =
      target.kind === "page"
        ? {
            at: target.url ?? "about:blank",
            id: StoreId.newTabId(),
            kind: "page",
          }
        : {
            at: target.kind === "app" ? target.address : target.path,
            id: StoreId.newTabId(),
            kind: "screen",
          };
    tabs.set(tab.id, tab);
    return tab;
  };

  const act = (action: WindowTabAction): Omit<WindowTabAnswer, "requestId"> => {
    if (action.kind === "open") {
      const tab = add(action.target);
      if (action.show) {
        front = tab.id;
      }
      if (layout) {
        return { behind: placed(tab, action.show), tabId: tab.id };
      }
      return { tabId: tab.id };
    }
    // A page the chat's own browser opened, given a tab beside the chat as
    // the app's `openBeside` gives it one.
    if (action.kind === "adopt") {
      const tab: StandInTab = {
        at: action.url,
        id: action.tabId,
        kind: "page",
      };
      tabs.set(tab.id, tab);
      if (layout) {
        placed(tab, false);
      }
      return { tabId: action.tabId };
    }
    if (action.kind === "list" && layout) {
      return withApart({
        pages: [...tabs.values()].flatMap((tab) =>
          tab.kind === "page" ? [{ id: tab.id, title: "", url: tab.at }] : [],
        ),
        read: { layout: structuredClone(layout), movedIn: {}, movedOut: {} },
      });
    }
    if (action.kind === "list") {
      return withApart({
        pages: [...tabs.values()].flatMap((tab) =>
          tab.kind === "page" ? [{ id: tab.id, title: "", url: tab.at }] : [],
        ),
        read: {
          layout: {
            focused: 0,
            group: { id: "group_stand_in" },
            sides: [
              {
                tabs: [...tabs.values()].map((tab) => ({
                  address: tab.kind === "page" ? tab.at : "instrument://screen",
                  id: tab.id,
                  ...(tab.id === front && { isUp: true }),
                  kind:
                    tab.kind === "page"
                      ? ("website" as const)
                      : ("builtIn" as const),
                  title: "",
                })),
              },
            ],
          },
          movedIn: {},
          movedOut: {},
        },
      });
    }
    if (
      action.kind === "showGroup" ||
      action.kind === "closeGroup" ||
      action.kind === "joinSides" ||
      action.kind === "pinGroup" ||
      action.kind === "placeGroup"
    ) {
      return { error: `no tab group ${action.group} is open.` };
    }
    if (action.kind === "history") {
      return { history: [] };
    }
    if (action.kind === "bookmarks") {
      return { bookmarks: structuredClone(bookmarks) };
    }
    if (action.kind === "addBookmark") {
      return { error: "the stand-in window adds no bookmarks." };
    }
    if (action.kind === "changeBookmarks") {
      return changeBookmarks(action.change);
    }
    // What the app opens on its own as a turn ends is no ask of the agent's.
    if (action.kind === "handOver") {
      return {};
    }
    if (action.kind === "moveTabs") {
      // Its one group keeps the order it has: a case scores what was asked.
      if (action.group === undefined) {
        return {};
      }
      return { error: "the stand-in window has no tab group to move them to." };
    }
    if (action.kind === "newWindow") {
      // Its tabs leave the case's group for a window of their own, which a
      // list then names, so the chat can see the window it opened.
      for (const id of action.tabIds) {
        const tab = tabs.get(id);
        if (tab) {
          apart.set(id, tab);
          tabs.delete(id);
          for (const side of layout?.sides ?? []) {
            side.tabs = side.tabs.filter((each) => each.id !== id);
          }
        }
      }
      if (front !== undefined && apart.has(front)) {
        front = undefined;
      }
      return { group: action.group ?? NEW_WINDOW_GROUP };
    }
    if (action.kind === "groupTabs" || action.kind === "reopenClosed") {
      return { error: "the stand-in window has one tab group." };
    }
    const tab = tabs.get(action.tabId);
    if (!tab) {
      return { error: `no tab ${action.tabId} is open.` };
    }
    switch (action.kind) {
      case "close": {
        tabs.delete(tab.id);
        return { tabId: tab.id };
      }
      case "replace": {
        const { target } = action;
        if (target.kind === "page" && tab.kind === "page") {
          tabs.set(tab.id, { ...tab, at: target.url ?? tab.at });
          return { tabId: tab.id };
        }
        tabs.delete(tab.id);
        return { tabId: add(target).id };
      }
      case "read": {
        return { error: "the stand-in window has no page to read." };
      }
      case "restore": {
        return { tabId: tab.id };
      }
      case "show": {
        front = tab.id;
        raise(tab.id);
        return { tabId: tab.id };
      }
    }
  };

  /**
   * The window's answer, with the shared Chrome (when the run has one) made
   * to match: a page tab opened, sent elsewhere, closed, brought back or read
   * there, so every session of the chat reaches the same page.
   */
  const actOnPages = async (
    action: WindowTabAction,
  ): Promise<Omit<WindowTabAnswer, "requestId">> => {
    if (!chrome) {
      return act(action);
    }
    if (action.kind === "read") {
      const tab = tabs.get(action.tabId);
      if (!tab || tab.kind !== "page") {
        return { error: `no tab ${action.tabId} is open.` };
      }
      await chrome.ensure(tab.id, tab.at);
      const text = pageTextOf(await chrome.evaluate(tab.id, READ_PAGE_TEXT));
      return { tabId: tab.id, text: text ?? "" };
    }
    const answer = act(action);
    const { tabId } = answer;
    if (action.kind === "open" && tabId && action.target.kind === "page") {
      await chrome.ensure(tabId, action.target.url ?? "about:blank");
    } else if (
      action.kind === "replace" &&
      tabId &&
      action.target.kind === "page"
    ) {
      await chrome.ensure(tabId);
      await chrome.navigate(tabId, action.target.url ?? "about:blank");
    } else if (action.kind === "restore" && tabId) {
      await chrome.ensure(tabId, tabs.get(tabId)?.at);
    } else if (action.kind === "close" && tabId) {
      await chrome.remove(tabId);
    } else if (action.kind === "list" && answer.pages) {
      const live = new Map(chrome.pages().map((page) => [page.id, page]));
      return {
        ...answer,
        pages: answer.pages.map((tab) => {
          const page = live.get(tab.id);
          return page ? { ...tab, title: page.title, url: page.url } : tab;
        }),
      };
    }
    return answer;
  };

  /** A page tab of the window, by its target id. */
  const pageOf = (targetId: string) => {
    const tab =
      parseBrowserTargetId(targetId) === null ? undefined : tabs.get(targetId);
    return tab?.kind === "page" ? tab : undefined;
  };

  return {
    /** The browser config with the window's page tabs live. */
    browser(base: BrowserConfig): BrowserConfig {
      return {
        ...base,
        getTargetMeta: (targetId) => {
          const page = pageOf(targetId);
          const meta = base.getTargetMeta(targetId);
          return page && !meta
            ? // Nothing reads a stand-in tab's storage.
              { partitionDir: AbsolutePathSchema.parse("/") }
            : meta;
        },
        listTargets: async () => [
          ...(await base.listTargets()),
          ...[...tabs.values()].flatMap((tab) => {
            const tabId = StoreId.TabSchema.safeParse(tab.id);
            return tab.kind === "page" && tabId.success
              ? [
                  {
                    id: browserTargetOf(tabId.data),
                    title: "",
                    type: "page" as const,
                    url: tab.at,
                  },
                ]
              : [];
          }),
        ],
      };
    },
    /** Answers the run's asks of the window until the returned function is called. */
    listen(): () => void {
      return publisher.subscribe("window.tab", (ask) => {
        void actOnPages(ask.action)
          .catch((error: unknown) => ({
            error: error instanceof Error ? error.message : String(error),
          }))
          .then((answer) => {
            publisher.publish("window.tabDone", {
              id: ask.id,
              requestId: ask.requestId,
              ...answer,
            });
          });
      });
    },
    /** Opens a page tab under the id given, the way a task's own tab arrives behind. */
    openPage({ at, id }: { at: string; id: string }) {
      tabs.set(id, { at, id, kind: "page" });
    },
    /**
     * Lays the window out as the case's group, which the chat's opens then
     * land in as the app places them. A case with no group and no tabs of
     * its own starts as a new chat does, alone in its group.
     */
    lay(read: LayoutRead | undefined) {
      const start = read?.layout ?? (tabs.size === 0 ? CHAT_ALONE : undefined);
      layout = start === undefined ? undefined : structuredClone(start);
      previous = undefined;
      for (const tab of layout?.sides.flatMap((side) => side.tabs) ?? []) {
        if (!tab.isThisChat) {
          tabs.set(tab.id, {
            at: tab.address,
            id: tab.id,
            kind: tab.kind === "website" ? "page" : "screen",
          });
        }
      }
    },
    /** Keeps the bookmarks a case says the user has. */
    keep(listed: readonly ListedBookmark[] | undefined) {
      if (listed) {
        bookmarks = structuredClone([...listed]);
      }
    },
    /** Opens the tabs a case's note names, under the ids the note gives them. */
    seed(viewing: SessionMessageDataPart.ViewContextDataPart | undefined) {
      for (const tab of [
        ...(viewing?.tabs ?? []),
        ...(viewing?.page?.tabs ?? []).map((page) => ({
          at: page.url,
          id: page.id,
        })),
      ]) {
        if (tab.id) {
          tabs.set(tab.id, {
            at: tab.at,
            id: tab.id,
            // A page is at an address; a file or a screen at a path or route.
            kind: /^[a-z][a-z+.-]*:/i.test(tab.at) ? "page" : "screen",
          });
          if (chrome && /^https?:/i.test(tab.at)) {
            void chrome.ensure(tab.id, tab.at);
          }
        }
      }
    },
    tabs,
  };
}
