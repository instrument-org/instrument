import {
  addToAllBookmarks,
  bookmarkListing,
  listedBookmark,
  useAddBookmark,
} from "@/client/bookmarks/actions";
import { bookmarksStateAtom } from "@/client/bookmarks/store";
import { fileUrlOf } from "@/client/lib/file-url";
import { useSteadyCallbacks } from "@/client/hooks/use-steady-callbacks";
import { takeKeyboardOnArrival } from "@/client/lib/browser-pool";
import { captureException } from "@/client/lib/capture-exception";
import { keepListening } from "@/client/lib/keep-listening";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import {
  type ChatId,
  browserTargetOf,
  isFolderPath,
  StoreId,
  WINDOW_ID,
  type WindowTabAnswer,
  type WindowTabRequest,
} from "@instrument-org/workspace/client";
import { type SidebarPlace } from "@/shared/tabs";
import { safe } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "jotai";
import { sleep } from "radashi";
import { useEffect, useRef } from "react";
import { toast } from "@/client/lib/toast";

import { isSiteGroup, type useAppTabs } from "./app-tabs";
import { type BrowserTabsHandle } from "./browser-tabs";
import { chatListOptions } from "./chat-list-query";
import { asksOwnPlace, type OpenAllTab, type OpenOptions } from "./context";
import { settingsHrefOf } from "@/client/components/settings/settings-href";
import { opensBeside } from "./beside-chat";
import { bringForwardShowing } from "./built-in-pages";
import { isInVersionsFolder, versionHref } from "./file-versions";
import { isGroupScreenHref } from "./group-screen";
import { openMenuLink } from "./menu-link";
import {
  reuseBlankOf,
  chatPlacementOf,
  gestureOf,
  inGroup,
  pagePlacementOf,
  type PlacementContext,
  screenPlacementOf,
} from "./placement";
import { visitInTab } from "./tab-history";
import { taskHref, tasksOfHref } from "./tab-location";
import { isChatTab, isFreshTab, isSplit, sideIndexOf } from "./tab-model";
import {
  chatHref,
  chatOfHref,
  chatOfHrefPrefix,
  chatOfSessionPrefix,
  chatSessionOfHref,
  matchScreen,
} from "./window-href";
import { newScreenId, type useWindowTabs } from "./window-tabs";
import {
  agentChatTabOf,
  noTabAt,
  pageOpenPlaceOf,
  tabHrefOfAppAddress,
} from "./agent-opens";
import { type AppsBySlug } from "./apps-by-slug";
import {
  bringsBack,
  entryText,
  placeOf as placeOfAction,
  timelineOf,
} from "@/client/components/activity/activity-timeline";
import { type WindowTab } from "@/client/atoms/window";
import { type OpenTarget } from "@/client/lib/open-target";
import { osConventions } from "@/client/lib/utils";
import { instrumentUrlOf } from "@instrument-org/shared";
import { draftsAtom } from "@/client/drafts/store";
import { appTabsAtom } from "./app-tabs";
import { draftTitle } from "./chats";
import { pageTabTitle } from "./file-tabs";
import { screenPresentation } from "./screen-presentation";
import { closedText } from "./closed-groups";
import {
  closedGroupTabOf,
  closedSideOf,
  closedTabGroupOf,
  closedTabsOf,
  draftOfTab,
} from "./tab-model";
import { groupLayoutFor, groupReadOf } from "./group-awareness";
import { windowTabGroupsAtom } from "./open-groups";
import { openLinkAddress, setLinkedShower } from "./open-link-address";
import { agentPageOfTab, ownerOfHostGroup, pageFileOfTab } from "./hosted-page";

/**
 * How long an agent's ask holds back the ones after it, which otherwise are
 * acted on in the order they came. One waiting on a page that never answers
 * would hold them for good. Shorter than an ask waits for its answer
 * (`WINDOW_TAB_TIMEOUT_MS`), so one right behind it is still answered.
 */
const ASK_HOLD_MS = 1000;

/**
 * What the conversation asks to open, as it asks: a page as a tab, a path
 * of the user's as the tab that shows it. The openers are read at the moment
 * of each ask, since they close over the tabs as they are then.
 */
export function useOpeners({
  appsBySlug,
  appTabs,
  browser,
  chatTitles,
  closedEntryOf,
  closeGroup,
  closeTab,
  groupTabs,
  isOpen,
  moveTabs,
  newGroup,
  openChat,
  reopenClosed,
  showGroup,
  windowTabs,
}: {
  /** The apps by slug, which name an app's page in a group as a chat reads it. */
  appsBySlug: AppsBySlug;
  /** The window's tabs: what is not a chat's opens by moving the tab up, or in a tab of its own. */
  appTabs: ReturnType<typeof useAppTabs>;
  /** The window's browser; null until it is mounted. */
  browser: BrowserTabsHandle | null;
  chatTitles: Map<ChatId, string>;
  /** The entry of this window's closed list a closed tab group or tab is on, by the group's or the tab's id. */
  closedEntryOf: (kind: "group" | "tab", id: string) => string | undefined;
  /**
   * Closes a tab group this window lists as its sidebar's X does, answering
   * whether it went on the closed list, which a group of only an agent's own
   * tabs does not (`agentCloseKeeps`); undefined for one it does not list.
   */
  closeGroup: (group: string) => { isListed: boolean } | undefined;
  /** Closes a tab as the person's close does, onto the closed list unless it is an agent's own (`agentCloseKeeps`). */
  closeTab: (id: string) => void;
  /** Makes a new tab group of tabs in this window, as Move to New Tab Group moves one, the window staying on its group; answers the group. */
  groupTabs: (ids: readonly string[]) => string;
  /** Moves tabs into a tab group, as dropping each on its row does. */
  moveTabs: (ids: readonly string[], group: string) => void;
  /** Whether what the window opens on is made; nothing is opened before it is. */
  isOpen: boolean;
  /**
   * Makes a new tab group at the top of the list or the place named, filled by what is given,
   * and brings it up; or, not shown here, only makes it, for a window of its
   * own to open on. Answers the group.
   */
  newGroup: (
    fill: (group: string) => void,
    options?: {
      isShownHere?: boolean;
      place?: SidebarPlace;
      returns?: "untilUnrelated";
    },
  ) => string;
  /** Opens a chat as a new tab group of its own (`useTabGroupActions().openChat`). */
  openChat: (chat: ChatId) => void;
  /** Brings one entry of this window's closed list back, as Shift+Cmd+T does. */
  reopenClosed: (entry: string) => void;
  /** Brings a tab group up, here or in the window that has it open, or moves it to a window of its own. */
  showGroup: (group: string, options?: { newWindow?: boolean }) => void;
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const queryClient = useQueryClient();
  const store = useStore();
  const { active } = windowTabs;
  /** The window as an open is placed against, read at the ask. */
  const placing: PlacementContext = {
    groupOnScreen: windowTabs.groupOnScreen,
    isChatOnScreen: windowTabs.groupOnScreen !== undefined,
    up: active && {
      givesPlace:
        isFreshTab(active) &&
        windowTabs.groupOnScreen !== undefined &&
        !isSplit(windowTabs.layoutOf(windowTabs.groupOnScreen)),
      kind: active.kind,
    },
  };
  /**
   * Where an open a chat asked for goes (`OpenOptions.chat`): placed
   * against the chat's tab it was asked from (`from`), else the chat's tab
   * the person last sent from (`chatTab`), in that tab's group. Beside it
   * where that tab's page type opens beside it (`opensBeside`), otherwise
   * right after it. One asked from a group's tab (`beside`) opens beside
   * that tab. Undefined for a chat with no tab, which opens where anything
   * else would.
   */
  const placeOf = (
    options: OpenOptions,
  ): undefined | { after: string; group: string; isBeside: boolean } => {
    if (options.chat === undefined) {
      const beside = windowTabs.allTabs.find(
        (tab) => tab.id === options.beside,
      );
      return beside?.group === undefined
        ? undefined
        : { after: beside.id, group: beside.group, isBeside: true };
    }
    const asking = windowTabs.allTabs.find((tab) => tab.id === options.from);
    const tab =
      asking?.group === undefined ? windowTabs.chatTab(options.chat) : asking;
    return tab?.group === undefined
      ? undefined
      : { after: tab.id, group: tab.group, isBeside: opensBeside(tab) };
  };
  /**
   * Where what a chat's agent opens goes: right after the chat's tab the
   * person last sent from (`chatTab`), in that tab's group, or why nothing
   * opens (`agentChatTabOf`). An agent never makes a group.
   */
  const agentPlaceOf = (chat: ChatId | undefined) =>
    agentChatTabOf(chat, windowTabs.chatTab);
  /**
   * Opens something in a place picked from a menu (`OpenOptions.into`):
   * `put` opens it in a group, at a place there. In a split, that is the
   * other side from the tab it was asked from, right after the tab up
   * there, the side made where the group has one.
   */
  const openInto = (
    {
      from,
      into,
    }: Pick<OpenOptions, "from"> & { into: "group" | "split" | "window" },
    put: (place: { after?: string; group: string; side?: 0 | 1 }) => void,
  ) => {
    if (into === "group") {
      // Under the group it was asked from; from a pinned one, or from no
      // group's tab, at the top, which is under the line.
      const source = windowTabs.allTabs.find((tab) => tab.id === from)?.group;
      newGroup(
        (group) => {
          put({ group });
        },
        {
          returns: "untilUnrelated",
          ...(source === undefined || windowTabs.groupOwn[source]?.pinned
            ? {}
            : { place: { after: source } }),
        },
      );
      return;
    }
    if (into === "window") {
      const group = newGroup(
        (made) => {
          put({ group: made });
        },
        { isShownHere: false },
      );
      showGroup(group, { newWindow: true });
      return;
    }
    const tab = windowTabs.allTabs.find((each) => each.id === from) ?? active;
    const group = tab?.group ?? windowTabs.groupOnScreen;
    if (group === undefined) {
      newGroup((made) => {
        put({ group: made });
      });
      return;
    }
    const layout = windowTabs.layoutOf(group);
    const here =
      (tab === undefined ? undefined : sideIndexOf(layout, tab.id)) ??
      layout.focused;
    const there = here === 1 ? 0 : 1;
    const up = layout.sides.length === 2 ? layout.sides[there]?.up : undefined;
    put({ ...(up === undefined ? {} : { after: up }), group, side: there });
  };
  /**
   * Opens several things as one new tab group (`openInto`), up here or as a
   * window of its own: each right after the one before, the first up. A
   * screen no group's tab can stand at, nor a chat, is left out.
   */
  const openAll = (tabs: readonly OpenAllTab[], into: "group" | "window") => {
    const standing = tabs.filter(
      (tab) =>
        tab.kind === "page" ||
        isGroupScreenHref(tab.href) ||
        matchScreen(tab.href).kind === "chat",
    );
    if (standing.length === 0) {
      return;
    }
    openInto({ into }, ({ group }) => {
      let after: string | undefined;
      for (const [index, tab] of standing.entries()) {
        const place = { ...(after === undefined ? {} : { after }), group };
        const isFirst = index === 0;
        after =
          tab.kind === "page"
            ? (browser?.open(tab.url, {
                ...place,
                behind: !isFirst,
                show: isFirst,
              }) ?? after)
            : (windowTabs.openScreen(tab.href, {
                ...place,
                select: isFirst,
              }) ?? after);
      }
    });
  };
  /**
   * The tab up is about to go somewhere asked of the window: one walked by
   * something in it (`from`), or by nobody (`here`), goes on as it was.
   */
  const startOver = ({ from, here }: OpenOptions) => {
    if (from === undefined && !here && active) {
      windowTabs.startedOver(active.id);
    }
  };
  /** Brings a group on screen for something shown into it from outside it. */
  const bringUp = (group: string) => {
    if (group !== windowTabs.groupOnScreen) {
      showGroup(group);
    }
  };
  /**
   * Opens a page: in the tab on screen when it is a page of the window's
   * own, in a tab of its own when asked for one, and into a named group when
   * the open belongs to a group other than the one up, where it waits
   * behind. One a chat asked for opens beside the chat (`placeOf`).
   */
  const openPage = (url: string, opened: OpenOptions = {}) => {
    const asked = reuseBlankOf(opened, placing);
    if (asked.into) {
      let id: string | undefined;
      openInto({ ...asked, into: asked.into }, (picked) => {
        id = browser?.open(url, { ...picked, show: true });
      });
      return id;
    }
    const place = placeOf(asked);
    const options = inGroup(place ? { ...asked, group: place.group } : asked);
    // What a chat opened lands where the person's gesture there says
    // (`openBesideChat`).
    if (place !== undefined) {
      if (options.show) {
        bringUp(place.group);
      }
      if (place.isBeside) {
        return browser?.openBeside(url, {
          chatTab: place.after,
          gesture: gestureOf(asked),
        })?.id;
      }
      const isUp =
        options.behind !== true &&
        (options.show === true ||
          options.activate === true ||
          place.group === windowTabs.groupOnScreen);
      return browser?.openOrFocus(url, {
        after: place.after,
        behind: !isUp,
        from: { reason: "link", tab: place.after },
        group: place.group,
        show: isUp,
      });
    }
    const placement = pagePlacementOf(options, placing);
    switch (placement.kind) {
      case "group-behind": {
        const { activate, group, show } = placement;
        if (show) {
          bringUp(group);
        }
        const id = browser?.openOrFocus(url, { group, show });
        if (activate && id !== undefined) {
          windowTabs.select(id);
        }
        return id;
      }
      case "group-new-tab": {
        if (asked.atEnd) {
          return browser?.open(url, {
            behind: placement.behind,
            group: windowTabs.groupOnScreen,
          });
        }
        return browser?.open(url, {
          behind: placement.behind,
          newTab: true,
          ...(asked.from === undefined
            ? {}
            : { from: { reason: "link", tab: asked.from } }),
        });
      }
      case "navigate-up": {
        startOver(asked);
        browser?.navigate(url);
        return active?.id;
      }
      case "new-page": {
        startOver(asked);
        const replacing =
          placement.replacesUp && active ? { replacing: active } : undefined;
        const id = browser?.open(url, replacing);
        // A page taking the place of what the person was in takes the
        // keyboard with it; one an agent asked for a tab of its own does not.
        if (replacing && !options.ownTab && id !== undefined) {
          takeKeyboardOnArrival(browserTargetOf(id));
        }
        return id;
      }
      case "own-tab": {
        return browser?.openOrFocus(url);
      }
      case "window-site":
      case "window-tab": {
        // With no tab group up, the page is the first tab of a new one.
        let id: string | undefined;
        newGroup((group) => {
          id = browser?.open(url, { group });
        });
        if (!options.ownTab && id !== undefined) {
          takeKeyboardOnArrival(browserTargetOf(id));
        }
        return id;
      }
    }
  };
  /** Opens a chat as a tab where `chatPlacementOf` says. */
  const openChatTab = (chat: ChatId, asked: OpenOptions) => {
    const href = chatHref(chat);
    const placement = chatPlacementOf(asked, placeOf(asked), placing);
    switch (placement.kind) {
      case "menu": {
        openInto({ ...asked, into: placement.into }, (picked) => {
          windowTabs.openScreen(href, { ...picked, select: true });
        });
        return;
      }
      case "beside": {
        windowTabs.openScreenBeside(href, {
          chatTab: placement.chatTab,
          gesture: placement.gesture,
        });
        return;
      }
      case "after": {
        windowTabs.openScreen(href, {
          after: placement.after,
          from: { reason: "link", tab: placement.after },
          group: placement.group,
          select: !placement.behind,
        });
        return;
      }
      case "group-new-tab": {
        windowTabs.openBeside(href, {
          behind: placement.behind,
          ...(asked.atEnd ? { atEnd: true } : {}),
          ...(asked.from === undefined ? {} : { from: asked.from }),
        });
        return;
      }
      case "in-place": {
        startOver(asked);
        windowTabs.navigateScreen(href);
        return;
      }
      case "own-group": {
        openChat(chat);
        return;
      }
    }
  };
  const openScreen = (href: string, asked: OpenOptions = {}): void => {
    // A chat named by its session, as an older reply's link names it,
    // opens at the chat that session is.
    const session = chatSessionOfHref(href);
    if (session) {
      void queryClient
        .fetchQuery(
          rpcClient.workspace.chats.ofSession.queryOptions({
            input: { sessionId: session },
            staleTime: Number.POSITIVE_INFINITY,
          }),
        )
        .then(
          ({ id }) => id,
          () => null,
        )
        .then((chat) => {
          if (chat) {
            openScreen(chatHref(chat), asked);
          } else {
            sayNoChat();
          }
        });
      return;
    }
    // A whole id, or the start of one the way a reply's link carries it,
    // among the chats the window has: a whole id that names none of them
    // is a link to a chat since deleted, not a chat with nothing in it.
    // Until the list has been read, a whole id is taken on its own.
    const chats = queryClient.getQueryData(chatListOptions().queryKey);
    const chat = chats
      ? (chatOfHrefPrefix(href, chatTitles.keys()) ??
        chatOfSessionPrefix(href, chats))
      : chatOfHref(href);
    if (chat) {
      openChatTab(chat, asked);
      return;
    }
    const screen = matchScreen(href);
    // A memory is a file, and opens as one wherever its link was; a name no
    // file has any more is said in Settings, over the memories there are.
    if (screen.kind === "memory") {
      void safe(
        rpcClient.workspace.memory.locate.call({ name: screen.name }),
      ).then(([error, hostPath]) => {
        if (error || hostPath === null) {
          if (placeOf(asked) === undefined) {
            openLinkAddress(href);
          } else {
            openScreen(
              settingsHrefOf({ memory: screen.name, tab: "Memory" }),
              asked,
            );
          }
        } else {
          openScreen(fileHref(hostPath), asked);
        }
      });
      return;
    }
    if (
      screen.kind === "chat" ||
      screen.kind === "chatLink" ||
      screen.kind === "chatOfSession"
    ) {
      // A chat's address that names none of the chats here: a screen
      // at it would be a chat with nothing in it.
      sayNoChat();
      return;
    }
    // A setting clicked in a chat, or asked for in a place of its own, is
    // its part of Settings with its row to light, placed as any other screen
    // is. Anywhere else it opens as Settings does (`openLinkAddress`).
    if (
      screen.kind === "setting" &&
      (placeOf(asked) !== undefined || asksOwnPlace(asked))
    ) {
      openScreen(settingsHrefOf({ setting: screen.name }), asked);
      return;
    }
    // A skill, a setting or a named screen opens where it lives,
    // which is a route of its own only for some named screens.
    const route = openLinkAddress(href);
    if (route === undefined) {
      return;
    }
    if (route !== href) {
      openScreen(route, asked);
      return;
    }
    const place = placeOf(asked);
    const options = inGroup(place ? { ...asked, group: place.group } : asked);
    // A task is a tab beside the chat it was filed from, in the group with
    // the chat's tab. A task's tab already up there walks there in place;
    // anything else brings up the tab at that address, or opens one beside
    // the chat as a click in the chat does (`besidePlacementOf`).
    const tasks = tasksOfHref(href);
    if (options.into && !tasks && isGroupScreenHref(href)) {
      openInto({ ...options, into: options.into }, (picked) => {
        windowTabs.openScreen(href, { ...picked, select: true });
      });
      return;
    }
    const owner = tasks
      ? (tasks.chat ??
        asked.chat ??
        (windowTabs.groupOnScreen === undefined
          ? undefined
          : windowTabs.chatUpIn(windowTabs.groupOnScreen)))
      : undefined;
    if (tasks && owner) {
      const at = taskHref(tasks.task, owner);
      const into = placeOf({ ...asked, chat: owner });
      // A task whose chat has no tab opens as a tab of its own after the
      // tab up, as anything else would.
      if (into === undefined) {
        if (
          windowTabs.openBeside(at, {
            behind: options.behind === true,
            ...(asked.from === undefined ? {} : { from: asked.from }),
          }) === undefined
        ) {
          openChat(owner);
        }
        return;
      }
      const up = windowTabs.selectedTabIn(into.group);
      const walksInPlace =
        !options.newTab &&
        !options.ownTab &&
        into.group === windowTabs.groupOnScreen &&
        up?.kind === "screen" &&
        tasksOfHref(up.href) !== undefined;
      if (walksInPlace) {
        if (!windowTabs.selectShowing(at)) {
          windowTabs.navigateScreen(at);
        }
        return;
      }
      const isShowing =
        into.group === windowTabs.groupOnScreen && windowTabs.selectShowing(at);
      if (!isShowing && into.isBeside) {
        windowTabs.openScreenBeside(at, {
          chatTab: into.after,
          gesture: gestureOf(asked),
        });
      } else if (!isShowing) {
        windowTabs.openOrFocusScreen(at, {
          after: into.after,
          from: { reason: "link", tab: into.after },
          group: into.group,
          select: true,
        });
      }
      showGroup(into.group);
      return;
    }
    // A task stands only beside its chat, so one whose chat is not named and
    // not on screen has nowhere to open, and never takes a window tab.
    if (tasks) {
      sayNoChat();
      return;
    }
    // What a chat opened lands where the person's gesture there says
    // (`openBesideChat`).
    if (
      place !== undefined &&
      isGroupScreenHref(href) &&
      screen.kind !== "app"
    ) {
      if (options.show) {
        bringUp(place.group);
      }
      if (place.isBeside) {
        windowTabs.openScreenBeside(href, {
          chatTab: place.after,
          gesture: gestureOf(asked),
        });
        return;
      }
      const isUp =
        options.behind !== true &&
        (options.show === true ||
          options.activate === true ||
          place.group === windowTabs.groupOnScreen);
      windowTabs.openOrFocusScreen(href, {
        after: place.after,
        from: { reason: "link", tab: place.after },
        group: place.group,
        select: isUp,
      });
      return;
    }
    const placement = screenPlacementOf(href, options, placing);
    switch (placement.kind) {
      case "group-behind": {
        const { group, select, show } = placement;
        if (show) {
          bringUp(group);
        }
        windowTabs.openOrFocusScreen(href, { group, select });
        return;
      }
      case "group-new-tab": {
        windowTabs.openBeside(href, {
          behind: placement.behind,
          ...(asked.atEnd ? { atEnd: true } : {}),
          ...(asked.from === undefined ? {} : { from: asked.from }),
        });
        return;
      }
      case "group-navigate": {
        // A file opened from a Finder takes the Finder's place in its tab,
        // the way a folder does, and back returns to the folder, unless
        // another tab of the group already shows it. A built-in page already
        // open comes forward at the part asked for.
        if (options.here || !bringForwardShowing(windowTabs, href)) {
          startOver(asked);
          windowTabs.navigateScreen(href);
        }
        return;
      }
      case "group-open":
      case "group-own-tab": {
        windowTabs.openOrFocusScreen(href);
        return;
      }
      case "window-navigate":
      case "window-tab": {
        // What the window shows sits in a tab group: a tab of the group up,
        // or of a new one with none up. Only an address no group's tab can
        // stand at (`isGroupScreenHref`) is the window's own.
        const { groupOnScreen } = windowTabs;
        if (!isGroupScreenHref(href)) {
          appTabs.navigate(href);
        } else if (groupOnScreen === undefined || isSiteGroup(groupOnScreen)) {
          newGroup((group) => {
            windowTabs.openScreen(href, { group, select: true });
          });
        } else {
          windowTabs.openOrFocusScreen(href, {
            group: groupOnScreen,
            select: placement.kind === "window-navigate" || !placement.behind,
          });
        }
        return;
      }
    }
  };
  /**
   * Where a path a reply or the conversation named is on the computer, as the
   * address of the tab that shows it, or undefined, said to the user, when it
   * names nothing this window can reach.
   *
   * A path a chat named is read against that chat's own record: its own
   * folder and grants decide which paths it can reach. The window's
   * reach reads it where no chat is in view.
   */
  const hrefOfNamedPath = async (
    path: string,
    chat: ChatId | undefined,
  ): Promise<string | undefined> => {
    if (!isOpen) {
      return;
    }
    const isFolder = isFolderPath(path);
    const filePath = isFolder ? path.slice(0, -1) : path;
    const chatId =
      chat ??
      (windowTabs.groupOnScreen === undefined
        ? undefined
        : windowTabs.chatUpIn(windowTabs.groupOnScreen));
    const [error, hostPaths] = await safe(
      rpcClient.workspace.chats.files.hostPaths.call({
        filePaths: [filePath],
        chatId: chatId ?? WINDOW_ID,
      }),
    );
    const hostPath = hostPaths?.[filePath];
    if (error || !hostPath) {
      toast(`Nothing at “${path}”`, {
        description: isFolder
          ? "Not a folder Instrument can reach."
          : "Not a file Instrument can reach.",
      });
      return;
    }
    if (isFolder) {
      return folderHref(hostPath);
    }
    // A copy the chat kept of a file, as a reply's card draws one, opens as
    // a version of that file.
    if (chatId !== undefined && isInVersionsFolder(hostPath)) {
      const [, history] = await safe(
        rpcClient.workspace.chats.fileVersions.call({
          id: chatId,
          path: hostPath,
        }),
      );
      if (history?.viewing && history.file !== hostPath) {
        return versionHref(history.file, hostPath);
      }
    }
    return fileHref(hostPath);
  };
  /**
   * Opens a path a reply named: a file in its viewer, a folder as the folder
   * view standing in it.
   *
   * A reply names a path the way the conversation reaches it, and both tabs
   * are addressed by where the thing sits on the computer, so the translation
   * happens here, against the conversation's own layout. A path under nothing
   * the conversation has is one this window cannot stand in, and saying so
   * beats a tab rooted nowhere.
   */
  const openNamedPath = (path: string, options?: OpenOptions) => {
    void hrefOfNamedPath(path, options?.chat).then((href) => {
      if (href !== undefined) {
        openScreen(href, options);
      }
    });
  };
  /**
   * Brings a tab group up where the person can see it: its window in front,
   * showing it. Which side has the keyboard stays as the group left it.
   */
  const showWholeGroup = (group: string): { error?: string } => {
    if (!windowTabs.allTabs.some((tab) => tab.group === group)) {
      return { error: `no tab group ${group} is open.` };
    }
    showGroup(group);
    if (!document.hasFocus()) {
      void safe(rpcClient.window.bringForward.call());
    }
    return {};
  };
  /**
   * Brings a tab up on its side, and its group with it when the window
   * shows another: the keyboard stays on the side the group had it.
   */
  const showTabWhereItIs = (tabId: string): { error?: string } => {
    // A file tab's page names the file tab.
    const named = windowTabs.allTabs.find((entry) => entry.id === tabId);
    const owner = ownerOfHostGroup(named?.group);
    const tab =
      owner === undefined
        ? named
        : windowTabs.allTabs.find((entry) => entry.id === owner);
    if (tab?.group === undefined) {
      return { error: `no tab ${tabId} is open.` };
    }
    windowTabs.raise(tab.id);
    if (tab.group !== windowTabs.groupOnScreen) {
      return showWholeGroup(tab.group);
    }
    return {};
  };
  /**
   * What a link to a tab group or a tab does: brings it up, as `show` does,
   * or says it closed, with Reopen where this window's closed list has it.
   */
  const showLinked = (kind: "group" | "tab", id: string) => {
    const shown = kind === "group" ? showWholeGroup(id) : showTabWhereItIs(id);
    if (shown.error === undefined) {
      return;
    }
    const entry = closedEntryOf(kind, id);
    const what = kind === "group" ? "tab group" : "tab";
    if (entry === undefined) {
      toast(`That ${what} is gone`, {
        description: `It was closed, and it's no longer in History.`,
      });
      return;
    }
    toast(`That ${what} is closed`, {
      action: {
        label: "Reopen",
        onClick: () => {
          reopenClosed(entry);
        },
      },
    });
  };
  /**
   * Opens what an agent asked for in a tab group it named, not the one its
   * chat is in: after the tab up on the side with the keyboard, up there
   * unless the group is on screen, where it waits behind. The window stays
   * on the group it shows.
   */
  const openInNamedGroup = async (
    group: string,
    target: Extract<WindowTabRequest["action"], { kind: "open" }>["target"],
    chat: ChatId | undefined,
  ): Promise<Omit<WindowTabAnswer, "requestId">> => {
    if (!windowTabs.allTabs.some((tab) => tab.group === group)) {
      return { error: `no tab group ${group} is open.` };
    }
    const layout = windowTabs.layoutOf(group);
    const after = layout.sides[layout.focused]?.up;
    const isOnScreen = group === windowTabs.groupOnScreen;
    if (target.kind === "page") {
      if (target.url === undefined) {
        return { error: "a tab in another group needs an address." };
      }
      const id = isOnScreen
        ? browser?.openBehind(target.url, {
            ...(after === undefined ? {} : { after }),
            group,
          })
        : browser?.open(target.url, {
            ...(after === undefined ? {} : { after }),
            group,
            show: false,
          });
      return id === undefined
        ? { error: "the window did not open a tab." }
        : { behind: isOnScreen, tabId: id };
    }
    const href =
      target.kind === "app"
        ? tabHrefOfAppAddress(target.address)
        : await hrefOfNamedPath(target.path, chat);
    if (href === undefined) {
      return {
        error:
          target.kind === "app"
            ? noTabAt(target.address)
            : `nothing this window can show is at ${target.path}.`,
      };
    }
    const id = newScreenId();
    windowTabs.openIn(
      { group, href, id, kind: "screen" },
      { ...(after === undefined ? {} : { after }), group, select: !isOnScreen },
    );
    return {
      behind: isOnScreen,
      tabId: agentPageOf({ group, href, id, kind: "screen" }) ?? id,
    };
  };
  /**
   * The window's History as its list shows it, newest first: the tabs,
   * sides and groups this window closed, by the closed list's ids, and,
   * unless only those are asked for, the places visited, from the log.
   */
  const historyRows = async ({
    closedOnly,
    limit,
  }: {
    closedOnly: boolean;
    limit: number;
  }): Promise<NonNullable<WindowTabAnswer["history"]>> => {
    const titleOf = (tab: WindowTab) =>
      tab.kind === "page"
        ? pageTabTitle(tab) || (tab.url ?? tab.openedUrl ?? "")
        : screenPresentation(tab.href, { appsBySlug, chatTitles }).title;
    const closed = store.get(appTabsAtom).recentlyClosed.flatMap((entry) => {
      const whole = closedTabGroupOf(entry);
      const tabs = closedTabsOf(entry);
      if (entry.closedAt === undefined || tabs.length === 0) {
        return [];
      }
      const kind =
        whole === undefined
          ? ("tab" as const)
          : closedSideOf(entry)
            ? ("side" as const)
            : ("group" as const);
      return [
        {
          at: entry.closedAt,
          ...closedText({ kind, titles: tabs.map(titleOf) }),
          id: entry.id,
          kind: (
            {
              group: "closedGroup",
              side: "closedSide",
              tab: "closedTab",
            } as const
          )[kind],
        },
      ];
    });
    const [, read] = closedOnly
      ? [undefined, undefined]
      : await safe(
          rpcClient.actions.list.call({ limit: Math.max(limit, 50), since: 0 }),
        );
    const isComplete = closedOnly || read?.next === null;
    const actions = read?.actions ?? [];
    const { entries } = timelineOf({
      actions: { complete: isComplete, items: actions },
      requests: { complete: true, items: [] },
      view: "yours",
    });
    const words = { trash: osConventions().trash };
    const visits = entries.filter(bringsBack).map((entry) => {
      const target =
        entry.kind === "action" ? placeOfAction(entry.action) : undefined;
      const address = target === undefined ? undefined : addressOf(target);
      return {
        ...(address === undefined ? {} : { address }),
        at: entry.at,
        ...entryText(entry, {
          isMixed: false,
          modelName: () => "",
          words,
        }),
        id: entry.id,
        kind: "visit" as const,
      };
    });
    // Past the oldest action read there may be others not read yet, so no
    // close from before it is listed.
    const readFrom = isComplete
      ? -Infinity
      : Math.min(...actions.map((action) => Date.parse(action.at)));
    return [...closed.filter(({ at }) => at >= readFrom), ...visits]
      .toSorted((a, b) => b.at - a.at)
      .slice(0, limit);
  };
  /**
   * Every open window's tab groups as a chat reads them, the one in front
   * first, its pinned groups before the rest as its sidebar has them, each
   * marked shown where its window shows it, with what its sidebar row and
   * its new tabs say; the chat's own tab marked in whichever group has it.
   */
  const windowsRead = async (
    chatTab: string | undefined,
  ): Promise<NonNullable<WindowTabAnswer["windows"]>> => {
    const [, windows] = await safe(rpcClient.window.tabGroupsByWindow.call());
    const listedHere = store.get(windowTabGroupsAtom) ?? [];
    const byWindow = windows ?? [
      {
        groups: listedHere,
        isThisWindow: true,
        ...(windowTabs.groupOnScreen === undefined
          ? {}
          : { shown: windowTabs.groupOnScreen }),
      },
    ];
    const hasTabs = (group: string) =>
      windowTabs.allTabs.some((tab) => tab.group === group);
    const isPinned = (group: string) =>
      windowTabs.groupOwn[group]?.pinned === true;
    const pinnedFirst = (groups: readonly string[]) => [
      ...groups.filter(isPinned),
      ...groups.filter((group) => !isPinned(group)),
    ];
    const drafts = store.get(draftsAtom);
    const unsentIn = (group: string): Record<string, string> =>
      Object.fromEntries(
        windowTabs.allTabs.flatMap((tab) => {
          const draft = tab.group === group ? draftOfTab(tab) : undefined;
          const words = drafts.find((each) => each.id === draft)?.words ?? "";
          return words.trim() === "" ? [] : [[tab.id, draftTitle(words)]];
        }),
      );
    return byWindow.map((window) => {
      // This window's own list is read here, as fresh as it is.
      const listed = window.isThisWindow ? listedHere : window.groups;
      const shown = window.isThisWindow
        ? windowTabs.groupOnScreen
        : window.shown;
      return {
        ...(window.isThisWindow ? { isThisWindow: true } : {}),
        groups: pinnedFirst(listed.filter(hasTabs)).map((group) => {
          const { isShown: _shownHere, ...layout } = groupLayoutFor(
            { appsBySlug, chatTitles, windowTabs },
            group,
            chatTab,
          );
          const own = windowTabs.groupOwn[group];
          const unsent = unsentIn(group);
          return {
            ...layout,
            ...(group === shown ? {} : { isShown: false }),
            ...(Object.keys(unsent).length === 0 ? {} : { drafts: unsent }),
            ...(own?.pinned ? { pinned: true } : {}),
            ...(own?.project === undefined ? {} : { project: own.project }),
            ...(own?.shownAt === undefined ? {} : { shownAt: own.shownAt }),
          };
        }),
      };
    });
  };
  /**
   * The page an agent drives in a tab, by the id it names the tab by: a page
   * tab's own, or, for a tab standing on a page's file, the page its viewer
   * draws, opened now when the tab has none yet (one opened behind and never
   * drawn). Nothing for any other screen.
   */
  const agentPageOf = (tab: WindowTab): string | undefined => {
    const page = agentPageOfTab(windowTabs.allTabs, tab);
    return page === undefined || "id" in page
      ? page?.id
      : browser?.openOrFocus(page.open.url, { group: page.open.group });
  };

  /**
   * Does what an agent asked of the tabs, and says what came of it: the tab
   * it made or acted on, or why it did nothing. A tab is any tab of the
   * window's, by its id. What it opens lands beside the chat's tab the
   * person last sent from (`agentPlaceOf`), as a click in the chat does,
   * except that a page for its own work stays behind on the chat's side;
   * a list is of that tab's group unless another is named.
   */
  const act = async ({
    action,
    chatId: chat,
  }: WindowTabRequest): Promise<Omit<WindowTabAnswer, "requestId">> => {
    if (action.kind === "open") {
      const { target } = action;
      if (target.kind === "page" && action.show && target.url === undefined) {
        return { error: "a tab on screen needs an address." };
      }
      if (action.group !== undefined) {
        const own = chat === undefined ? undefined : windowTabs.chatTab(chat);
        if (action.group !== own?.group) {
          return openInNamedGroup(action.group, target, chat);
        }
      }
      // Only beside the chat's tab, in its group: never a group of its own.
      const place = agentPlaceOf(chat);
      if ("error" in place) {
        return { error: place.error };
      }
      if (target.kind === "page") {
        const opened = browser?.openBeside(target.url, {
          chatTab: place.after,
          isShown: action.show,
          openedBy: chat,
        });
        return opened
          ? { behind: !opened.front, tabId: opened.id }
          : { error: "the window did not open a tab." };
      }
      const href =
        target.kind === "app"
          ? tabHrefOfAppAddress(target.address)
          : await hrefOfNamedPath(target.path, chat);
      if (href === undefined) {
        return {
          error:
            target.kind === "app"
              ? noTabAt(target.address)
              : `nothing this window can show is at ${target.path}.`,
        };
      }
      const opened = windowTabs.openScreenBeside(href, {
        chatTab: place.after,
        isShown: action.show,
        openedBy: chat,
      });
      // A page's file is named by its page, which an agent drives as it
      // drives any page tab.
      return opened
        ? {
            behind: !opened.front,
            tabId:
              agentPageOf({ href, id: opened.id, kind: "screen" }) ?? opened.id,
          }
        : { error: "the window did not open a tab." };
    }
    if (action.kind === "handOver") {
      // Only beside a chat's tab in this window; a chat open nowhere here
      // gets nothing.
      const place = agentPlaceOf(chat);
      if (chat === undefined || "error" in place) {
        return { error: "the chat has no tab here." };
      }
      const href = await hrefOfNamedPath(action.path, chat);
      const opened =
        href === undefined
          ? undefined
          : windowTabs.handOverBeside(href, {
              chatTab: place.after,
              openedBy: chat,
            });
      return opened
        ? { behind: !opened.front, tabId: opened.id }
        : { error: "the window did not open a tab." };
    }
    if (action.kind === "adopt") {
      const id = StoreId.TabSchema.safeParse(action.tabId);
      if (chat === undefined || !id.success) {
        return { error: "only a chat's page can be given a tab." };
      }
      const place = agentPlaceOf(chat);
      if ("error" in place) {
        return { error: place.error };
      }
      browser?.openBeside(action.url, {
        chatTab: place.after,
        id: id.data,
        isLoaded: true,
        isShown: false,
        openedBy: chat,
      });
      return { tabId: id.data };
    }
    if (action.kind === "showGroup") {
      return showWholeGroup(action.group);
    }
    if (action.kind === "closeGroup") {
      if (!windowTabs.allTabs.some((tab) => tab.group === action.group)) {
        return { error: `no tab group ${action.group} is open.` };
      }
      const closed = closeGroup(action.group);
      return closed
        ? { isListed: closed.isListed }
        : {
            error: `the tab group ${action.group} is open in another window; it closes from there.`,
          };
    }
    if (action.kind === "groupTabs" || action.kind === "moveTabs") {
      const missing = action.tabIds.filter(
        (id) =>
          windowTabs.allTabs.find((tab) => tab.id === id)?.group === undefined,
      );
      if (missing.length > 0) {
        return { error: `no tab ${missing.join(", ")} is open.` };
      }
      if (action.kind === "groupTabs") {
        return { group: groupTabs(action.tabIds) };
      }
      if (!windowTabs.allTabs.some((tab) => tab.group === action.group)) {
        return { error: `no tab group ${action.group} is open.` };
      }
      moveTabs(action.tabIds, action.group);
      return {};
    }
    if (action.kind === "history") {
      return { history: await historyRows(action) };
    }
    if (action.kind === "bookmarks") {
      return { bookmarks: bookmarkListing(store.get(bookmarksStateAtom)) };
    }
    if (action.kind === "addBookmark") {
      // Kept as a menu's Add to Bookmarks keeps it, by this window's store.
      const { bookmark, isNew } = addToAllBookmarks(store, action);
      return {
        bookmark: {
          ...listedBookmark(store.get(bookmarksStateAtom), bookmark),
          isNew,
        },
      };
    }
    if (action.kind === "reopenClosed") {
      const entry = store
        .get(appTabsAtom)
        .recentlyClosed.find((each) => each.id === action.entry);
      if (!entry) {
        return {
          error: `nothing in History is ${action.entry}; \`instrument window history --closed\` lists what can come back.`,
        };
      }
      const group =
        closedSideOf(entry)?.group ?? closedGroupTabOf(entry)?.group;
      const isOpenStill =
        group !== undefined &&
        windowTabs.allTabs.some((tab) => tab.group === group);
      reopenClosed(entry.id);
      return isOpenStill ? { group } : {};
    }
    if (action.kind === "list") {
      const own = chat === undefined ? undefined : windowTabs.chatTab(chat);
      const group = action.group ?? own?.group;
      const windows = await windowsRead(own?.id);
      if (group === undefined) {
        return { windows };
      }
      return {
        windows,
        // A tab on a page's file is listed as its page, by the page's id,
        // so the tab an agent drives is the one the person sees.
        pages: windowTabs.allTabs.flatMap((entry) => {
          if (entry.group !== group) {
            return [];
          }
          const pageId = agentPageOf(entry);
          const page = windowTabs.allTabs.find((each) => each.id === pageId);
          const file = pageFileOfTab(entry);
          return pageId === undefined
            ? []
            : [
                {
                  id: pageId,
                  title: (page?.kind === "page" && page.title) || "",
                  url:
                    (page?.kind === "page" && page.url) ||
                    (file === undefined ? "about:blank" : fileUrlOf(file)),
                },
              ];
        }),
        read: groupReadOf(
          { appsBySlug, chatTitles, windowTabs },
          group,
          own?.group === group ? own.id : undefined,
        ),
      };
    }
    // A file tab's page names the file tab, which every action takes.
    const named = windowTabs.allTabs.find((entry) => entry.id === action.tabId);
    const owner = ownerOfHostGroup(named?.group);
    const tab = windowTabs.allTabs.find(
      (entry) => entry.id === (owner ?? action.tabId),
    );
    if (!tab) {
      return { error: `no tab ${action.tabId} is open.` };
    }
    switch (action.kind) {
      case "close": {
        closeTab(tab.id);
        return { tabId: action.tabId };
      }
      case "replace": {
        if (isChatTab(tab)) {
          return {
            error: `tab ${tab.id} is a chat, which stays as it is; open the page in a tab of its own.`,
          };
        }
        const { target } = action;
        if (target.kind === "page") {
          if (target.url === undefined) {
            return { error: "replace needs an address or a path." };
          }
          if (tab.kind === "page") {
            browser?.navigateTab(tab.id, target.url);
            return { tabId: tab.id };
          }
          return { tabId: browser?.pageInPlaceOf(tab, target.url) };
        }
        const href =
          target.kind === "app"
            ? tabHrefOfAppAddress(target.address)
            : await hrefOfNamedPath(target.path, chat);
        if (href === undefined) {
          return {
            error:
              target.kind === "app"
                ? noTabAt(target.address)
                : `nothing this window can show is at ${target.path}.`,
          };
        }
        const next = visitInTab(tab, {
          href,
          id: newScreenId(),
          kind: "screen",
        });
        windowTabs.replace(tab.id, next);
        return { tabId: agentPageOf(next) ?? next.id };
      }
      case "read": {
        const pageId = agentPageOf(tab);
        if (pageId === undefined) {
          return {
            error: `tab ${tab.id} is not a page; read what it shows by its path.`,
          };
        }
        const text = await browser?.readPageText(pageId);
        return text === undefined
          ? {
              error: `tab ${pageId} has no page loaded to read; \`instrument window show ${pageId}\` loads it.`,
            }
          : { tabId: pageId, text };
      }
      case "restore": {
        const pageId = agentPageOf(tab);
        return pageId !== undefined && browser?.restore(pageId)
          ? { tabId: pageId }
          : { error: `tab ${action.tabId} is not a page.` };
      }
      case "show": {
        // Up on its side of its group, and the group on screen when the
        // window shows another; which side has the keyboard stays.
        const shown = showTabWhereItIs(tab.id);
        return shown.error === undefined ? { tabId: action.tabId } : shown;
      }
    }
  };

  /**
   * Does what an agent asked (`act`), marking a tab it made as its chat's:
   * one it opened or adopted, and one that took another's place.
   */
  const actOnTab = async (
    request: WindowTabRequest,
  ): Promise<Omit<WindowTabAnswer, "requestId">> => {
    const answer = await act(request);
    const { action, chatId: chat } = request;
    const made =
      action.kind === "open" ||
      action.kind === "adopt" ||
      (action.kind === "replace" && answer.tabId !== action.tabId);
    if (made && chat !== undefined && answer.tabId !== undefined) {
      windowTabs.markOpenedBy(answer.tabId, chat);
    }
    return answer;
  };

  /**
   * A tab a page asked for (a `target=_blank` link, a sign-in button, a
   * middle-, Cmd- or Shift-click, the page's menu) opens right after the page
   * that asked, on its side of its group, so a sign-in started there stays
   * there. Only the page menu's Open Link in New Tab Group or New Window
   * makes a group.
   */
  const openFromPage = ({
    background,
    into,
    tabId,
    targetId,
    url,
  }: {
    background: boolean;
    into?: "group" | "split" | "window";
    newWindow?: boolean;
    tabId?: StoreId.Tab;
    targetId: string;
    url: string;
  }) => {
    // A place the page's menu picked, the split across from the page's tab.
    const asking = windowTabs.allTabs.find((tab) => tab.id === targetId);
    if (into) {
      const from = pageOpenPlaceOf(asking, { isAgent: false });
      openPage(url, {
        from: from.kind === "after" ? from.after : targetId,
        into,
      });
      return;
    }
    // Only an agent's popup is named a tab by the workspace, and it never
    // makes a group: from a page with no tab it opens nothing.
    const place = pageOpenPlaceOf(asking, { isAgent: tabId !== undefined });
    if (place.kind === "free") {
      openPage(url, { behind: background, newTab: true });
    } else if (place.kind === "after" && background) {
      // The workspace names a popup's tab to the session that worked in the
      // page, so the tab opens under that id.
      browser?.openBehind(url, {
        after: place.after,
        // An agent's own popup is linked to nothing (`Opening`).
        ...(tabId === undefined
          ? { from: { reason: "link", tab: place.after } }
          : { id: tabId }),
        group: place.group,
        ...(asking?.openedBy === undefined
          ? {}
          : { openedBy: asking.openedBy }),
      });
    } else if (place.kind === "after") {
      browser?.open(url, {
        after: place.after,
        ...(tabId === undefined
          ? { from: { reason: "link", tab: place.after } }
          : {}),
        group: place.group,
      });
    }
  };

  const addBookmark = useAddBookmark();
  const linked = useRef(showLinked);
  useEffect(() => {
    linked.current = showLinked;
  });
  useEffect(() => {
    setLinkedShower((kind, id) => {
      linked.current(kind, id);
    });
    return () => {
      setLinkedShower(undefined);
    };
  }, []);
  const openers = useRef({
    actOnTab,
    addBookmark,
    openFromPage,
    openPage,
    pageBecameDownload: windowTabs.pageBecameDownload,
  });
  useEffect(() => {
    openers.current = {
      actOnTab,
      addBookmark,
      openFromPage,
      openPage,
      pageBecameDownload: windowTabs.pageBecameDownload,
    };
  });
  // A link in text being edited, opened from the window's native menu.
  useEffect(() => {
    const controller = new AbortController();
    void keepListening({
      signal: controller.signal,
      start: (signal) =>
        rpcClient.window.events.openMenuLink.call(undefined, { signal }),
      onEach: openMenuLink,
    });
    return () => {
      controller.abort();
    };
  }, []);
  // A link a person kept from a page's menu.
  useEffect(() => {
    const controller = new AbortController();
    void keepListening({
      signal: controller.signal,
      start: (signal) =>
        rpcClient.browser.events.bookmarkLink.call(undefined, { signal }),
      onEach: ({ title, url }) => {
        openers.current.addBookmark({ title, url });
      },
    });
    return () => {
      controller.abort();
    };
  }, []);
  // A link a person asked a page for in a tab of its own.
  useEffect(() => {
    const controller = new AbortController();
    void keepListening({
      signal: controller.signal,
      start: (signal) =>
        rpcClient.browser.events.openInNewTab.call(undefined, { signal }),
      onEach: (ask) => {
        openers.current.openFromPage(ask);
      },
    });
    return () => {
      controller.abort();
    };
  }, []);
  // A page whose first navigation became a download, left with nothing to show.
  useEffect(() => {
    const controller = new AbortController();
    void keepListening({
      signal: controller.signal,
      start: (signal) =>
        rpcClient.browser.events.pageBecameDownload.call(undefined, {
          signal,
        }),
      onEach: ({ targetId }) => {
        openers.current.pageBecameDownload(targetId);
      },
    });
    return () => {
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const controller = new AbortController();
    const answerAsk = async (request: WindowTabRequest) => {
      const answer = await openers.current
        .actOnTab(request)
        .catch((error: unknown) => {
          captureException(error);
          return { error: "the window could not do that." };
        });
      // The answer goes back to the command that asked, so the
      // conversation can hand a tab to a task, or say what went wrong,
      // without waiting for the next message's note.
      void rpcClient.workspace.window.tabDone.call({
        requestId: request.requestId,
        ...answer,
      });
    };
    void keepListening({
      signal: controller.signal,
      start: (signal) =>
        rpcClient.workspace.window.events.tab.call(undefined, { signal }),
      onEach: async (request) => {
        await Promise.race([answerAsk(request), sleep(ASK_HOLD_MS)]);
      },
    });
    return () => {
      controller.abort();
    };
  }, [isOpen]);
  // Steady, so what they are handed to (the command menu, every screen's
  // window context) is not drawn again each time the window is.
  return useSteadyCallbacks({
    openAll,
    openNamedPath,
    openPage,
    openScreen: (href: string, options?: OpenOptions) => {
      openScreen(href, reuseBlankOf(options ?? {}, placing));
    },
  });
}

/** Where a place History lists is, as the agent names it: a page's URL, a file's or folder's path, an app address. */
function addressOf(target: OpenTarget): string | undefined {
  if (target.kind === "page") {
    return target.url;
  }
  if (target.kind === "path") {
    return target.path;
  }
  const screen = matchScreen(target.href);
  if (screen.kind === "computer") {
    return screen.file ?? screen.path;
  }
  return instrumentUrlOf(target.href);
}

/** Says a chat's address named none of the chats here. */
function sayNoChat() {
  toast("No chat at that address", {
    description: "It may have been deleted, or the link is not for this chat.",
  });
}
