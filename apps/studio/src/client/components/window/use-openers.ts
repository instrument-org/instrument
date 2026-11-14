import { useAddBookmark } from "@/client/bookmarks/actions";
import { useSteadyCallbacks } from "@/client/hooks/use-steady-callbacks";
import { takeKeyboardOnArrival } from "@/client/lib/browser-pool";
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
import { safe } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "@/client/lib/toast";

import { isSiteGroup, type useAppTabs } from "./app-tabs";
import { type BrowserTabsHandle } from "./browser-tabs";
import { chatListOptions } from "./chat-list-query";
import { type OpenOptions } from "./context";
import { opensBeside } from "./beside-chat";
import { bringForwardShowing } from "./built-in-pages";
import { isGroupScreenHref } from "./group-screen";
import { openMenuLink } from "./menu-link";
import { openLinkAddress } from "./open-link-address";
import {
  pagePlacementOf,
  type PlacementContext,
  screenPlacementOf,
} from "./placement";
import { visitInTab } from "./tab-history";
import { taskHref, tasksOfHref } from "./tab-location";
import { isChatTab, isFreshTab, sideIndexOf } from "./tab-model";
import {
  chatHref,
  chatOfHref,
  chatOfHrefPrefix,
  chatOfSessionPrefix,
  chatSessionOfHref,
  matchScreen,
} from "./window-href";
import { newScreenId, type useWindowTabs } from "./window-tabs";
import { type AppsBySlug } from "./apps-by-slug";
import { groupReadOf } from "./group-awareness";

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
  isOpen,
  newGroup,
  openChat,
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
  /** Whether what the window opens on is made; nothing is opened before it is. */
  isOpen: boolean;
  /**
   * Makes a new tab group at the top of the list, filled by what is given,
   * and brings it up; or, not shown here, only makes it, for a window of its
   * own to open on. Answers the group.
   */
  newGroup: (
    fill: (group: string) => void,
    options?: { isListedBehind?: boolean; isShownHere?: boolean },
  ) => string;
  /** Opens a chat as a new tab group of its own (`useTabGroupActions().openChat`). */
  openChat: (chat: ChatId) => void;
  /** Brings a tab group up, here or in the window that has it open, or moves it to a window of its own. */
  showGroup: (group: string, options?: { newWindow?: boolean }) => void;
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const queryClient = useQueryClient();
  const { active } = windowTabs;
  /** The window as an open is placed against, read at the ask. */
  const placing: PlacementContext = {
    groupOnScreen: windowTabs.groupOnScreen,
    isChatOnScreen: windowTabs.groupOnScreen !== undefined,
    up: active && {
      isFresh: isFreshTab(active),
      kind: active.kind,
    },
  };
  /**
   * Where an open a chat asked for goes (`OpenOptions.chat`): placed
   * against the chat's tab it was asked from (`from`), else the chat's tab
   * the person last sent from (`chatTab`), in that tab's group. Beside it
   * where that tab's page type opens beside it (`opensBeside`), otherwise
   * right after it. Undefined for a chat with no tab, which opens where
   * anything else would.
   */
  const placeOf = (
    options: OpenOptions,
  ): undefined | { after: string; group: string; isBeside: boolean } => {
    if (options.chat === undefined) {
      return undefined;
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
   * person last sent from (`chatTab`). A chat with no tab, as one still at
   * work after its group closed, gets a new group at the top of the list
   * with a tab on the chat, which the window does not move to.
   */
  const agentPlaceOf = (chat: ChatId): { after: string; group: string } => {
    const tab = windowTabs.chatTab(chat);
    if (tab !== undefined) {
      return { after: tab.id, group: tab.group };
    }
    let place: { after: string; group: string } | undefined;
    newGroup(
      (group) => {
        const after = windowTabs.openScreen(chatHref(chat), {
          group,
          select: true,
        });
        place = after === undefined ? undefined : { after, group };
      },
      { isListedBehind: true },
    );
    if (place === undefined) {
      throw new Error("a new group always opens the chat's tab.");
    }
    return place;
  };
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
      newGroup((group) => {
        put({ group });
      });
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
  const openPage = (url: string, asked: OpenOptions = {}) => {
    if (asked.into) {
      let id: string | undefined;
      openInto({ ...asked, into: asked.into }, (picked) => {
        id = browser?.open(url, { ...picked, show: true });
      });
      return id;
    }
    if (asked.newWindow) {
      let id: string | undefined;
      newGroup((group) => {
        id = browser?.open(url, { group });
      });
      return id;
    }
    const place = placeOf(asked);
    const options = place ? { ...asked, group: place.group } : asked;
    if (place !== undefined && !options.newTab) {
      if (options.show) {
        bringUp(place.group);
      }
      if (place.isBeside) {
        return browser?.openBeside(url, {
          behind: options.behind === true,
          chatTab: place.after,
          isShown: true,
        })?.id;
      }
      const isUp =
        options.show === true ||
        options.activate === true ||
        place.group === windowTabs.groupOnScreen;
      return browser?.openOrFocus(url, {
        after: place.after,
        behind: !isUp,
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
        return browser?.open(url, { behind: placement.behind, newTab: true });
      }
      case "navigate-up": {
        browser?.navigate(url);
        return active?.id;
      }
      case "new-page": {
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
      // A chat opens as a group of its own, however many tabs it has
      // elsewhere. Asked for in a place of a menu's, it is a tab of its own
      // there.
      if (asked.into || asked.newWindow) {
        openInto({ ...asked, into: asked.into ?? "window" }, (picked) => {
          windowTabs.openScreen(chatHref(chat), { ...picked, select: true });
        });
        return;
      }
      openChat(chat);
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
          openLinkAddress(href);
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
    const options = place ? { ...asked, group: place.group } : asked;
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
      if (into === undefined) {
        openChat(owner);
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
          behind: options.behind === true,
          chatTab: into.after,
          isShown: true,
        });
      } else if (!isShowing) {
        windowTabs.openOrFocusScreen(at, {
          after: into.after,
          group: into.group,
          isOpened: true,
          select: true,
        });
      }
      showGroup(into.group, { newWindow: options.newWindow === true });
      return;
    }
    // A task stands only beside its chat, so one whose chat is not named and
    // not on screen has nowhere to open, and never takes a window tab.
    if (tasks) {
      sayNoChat();
      return;
    }
    if (options.newWindow) {
      newGroup((group) => {
        windowTabs.openScreen(href, { group, select: true });
      });
      return;
    }
    // What a chat opened lands beside the chat's tab (`placeOf`).
    if (
      place !== undefined &&
      !options.newTab &&
      isGroupScreenHref(href) &&
      screen.kind !== "app"
    ) {
      if (options.show) {
        bringUp(place.group);
      }
      if (place.isBeside) {
        windowTabs.openScreenBeside(href, {
          behind: options.behind === true,
          chatTab: place.after,
          isShown: true,
        });
        return;
      }
      const isUp =
        options.show === true ||
        options.activate === true ||
        place.group === windowTabs.groupOnScreen;
      windowTabs.openOrFocusScreen(href, {
        after: place.after,
        group: place.group,
        isOpened: true,
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
        windowTabs.openOrFocusScreen(href, { group, isOpened: true, select });
        return;
      }
      case "group-new-tab": {
        windowTabs.openBeside(href, { behind: placement.behind });
        return;
      }
      case "group-navigate": {
        // A file opened from a Finder takes the Finder's place in its tab,
        // the way a folder does, and back returns to the folder, unless
        // another tab of the group already shows it. A built-in page already
        // open comes forward at the part asked for.
        if (options.here || !bringForwardShowing(windowTabs, href)) {
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
        // or of a new one with none up. Only a screen no group's tab can
        // stand at (the debug pages) is the window's own.
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
            isOpened: true,
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
    const [error, hostPaths] = await safe(
      rpcClient.workspace.chats.files.hostPaths.call({
        filePaths: [filePath],
        chatId:
          chat ??
          (windowTabs.groupOnScreen === undefined
            ? undefined
            : windowTabs.chatUpIn(windowTabs.groupOnScreen)) ??
          WINDOW_ID,
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
    return isFolder ? folderHref(hostPath) : fileHref(hostPath);
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
      if (target.kind === "page") {
        if (action.show && target.url === undefined) {
          return { error: "a tab on screen needs an address." };
        }
        if (chat !== undefined) {
          const opened = browser?.openBeside(target.url, {
            behind: false,
            chatTab: agentPlaceOf(chat).after,
            isShown: action.show,
            openedBy: chat,
          });
          return opened
            ? { behind: !opened.front, tabId: opened.id }
            : { error: "the window did not open a tab." };
        }
        return target.url === undefined
          ? { error: "a tab on screen needs an address." }
          : { tabId: openPage(target.url, { ownTab: true }) };
      }
      const href = await hrefOfNamedPath(target.path, chat);
      if (href === undefined) {
        return { error: `nothing this window can show is at ${target.path}.` };
      }
      if (chat !== undefined) {
        const opened = windowTabs.openScreenBeside(href, {
          behind: false,
          chatTab: agentPlaceOf(chat).after,
          isShown: action.show,
          openedBy: chat,
        });
        return opened
          ? { behind: !opened.front, tabId: opened.id }
          : { error: `nothing this window can show is at ${target.path}.` };
      }
      const into = windowTabs.groupOnScreen;
      const tabId = windowTabs.openOrFocusScreen(href, {
        ...(into ? { group: into } : {}),
        isOpened: true,
        select: true,
      });
      return { tabId };
    }
    if (action.kind === "adopt") {
      const id = StoreId.TabSchema.safeParse(action.tabId);
      if (chat === undefined || !id.success) {
        return { error: "only a chat's page can be given a tab." };
      }
      browser?.openBeside(action.url, {
        behind: false,
        chatTab: agentPlaceOf(chat).after,
        id: id.data,
        isLoaded: true,
        isShown: false,
        openedBy: chat,
      });
      return { tabId: id.data };
    }
    if (action.kind === "list") {
      const own = chat === undefined ? undefined : windowTabs.chatTab(chat);
      const group = action.group ?? own?.group;
      if (group === undefined) {
        return { error: "name a tab group to list; this chat has no tab." };
      }
      return {
        pages: windowTabs.allTabs.flatMap((entry) =>
          entry.group === group && entry.kind === "page"
            ? [
                {
                  id: entry.id,
                  title: entry.title ?? "",
                  url: entry.url ?? "about:blank",
                },
              ]
            : [],
        ),
        read: groupReadOf(
          { appsBySlug, chatTitles, windowTabs },
          group,
          own?.group === group ? own.id : undefined,
        ),
      };
    }
    const tab = windowTabs.allTabs.find((entry) => entry.id === action.tabId);
    if (!tab) {
      return { error: `no tab ${action.tabId} is open.` };
    }
    switch (action.kind) {
      case "close": {
        windowTabs.close(tab.id);
        return { tabId: tab.id };
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
        const href = await hrefOfNamedPath(target.path, chat);
        if (href === undefined) {
          return {
            error: `nothing this window can show is at ${target.path}.`,
          };
        }
        const next = visitInTab(tab, {
          href,
          id: newScreenId(),
          kind: "screen",
        });
        windowTabs.replace(tab.id, next);
        return { tabId: next.id };
      }
      case "read": {
        if (tab.kind !== "page") {
          return {
            error: `tab ${tab.id} is not a page; read what it shows by its path.`,
          };
        }
        const text = await browser?.readPageText(tab.id);
        return text === undefined
          ? {
              error: `tab ${tab.id} has no page loaded to read; \`instrument window show ${tab.id}\` loads it.`,
            }
          : { tabId: tab.id, text };
      }
      case "restore": {
        return browser?.restore(tab.id)
          ? { tabId: tab.id }
          : { error: `tab ${tab.id} is not a page.` };
      }
      case "show": {
        // Up in its group; which group the window has on screen is the
        // person's, so that stays as it is.
        if (tab.group !== undefined) {
          windowTabs.select(tab.id);
        }
        return { tabId: tab.id };
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
   * middle- or Cmd-click, the page's menu) opens right after the page that
   * asked, on its side of its group, so a sign-in started there stays
   * there.
   */
  const openFromPage = ({
    background,
    into,
    newWindow = false,
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
    if (into) {
      openPage(url, { from: targetId, into });
      return;
    }
    // A group of its own has the page on its own, whichever group's page
    // asked for it.
    if (newWindow) {
      openPage(url, { newWindow });
      return;
    }
    const asking = windowTabs.allTabs.find((tab) => tab.id === targetId);
    if (asking?.group === undefined) {
      openPage(url, { behind: background, newTab: true });
    } else if (background) {
      // The workspace names a popup's tab to the session that worked in the
      // page, so the tab opens under that id.
      browser?.openBehind(url, {
        after: asking.id,
        group: asking.group,
        ...(tabId === undefined ? {} : { id: tabId }),
        ...(asking.openedBy === undefined ? {} : { openedBy: asking.openedBy }),
      });
    } else {
      browser?.open(url, { after: asking.id, group: asking.group });
    }
  };

  const addBookmark = useAddBookmark();
  const openers = useRef({ actOnTab, addBookmark, openFromPage, openPage });
  useEffect(() => {
    openers.current = { actOnTab, addBookmark, openFromPage, openPage };
  });
  // A link in text being edited, opened from the window's native menu.
  useEffect(() => {
    const controller = new AbortController();
    void eachSent(
      (signal) =>
        rpcClient.window.events.openMenuLink.call(undefined, { signal }),
      controller.signal,
      openMenuLink,
    );
    return () => {
      controller.abort();
    };
  }, []);
  // A link a person kept from a page's menu.
  useEffect(() => {
    const controller = new AbortController();
    void eachSent(
      (signal) =>
        rpcClient.browser.events.bookmarkLink.call(undefined, { signal }),
      controller.signal,
      ({ title, url }) => {
        openers.current.addBookmark({ title, url });
      },
    );
    return () => {
      controller.abort();
    };
  }, []);
  // A link a person asked a page for in a tab of its own.
  useEffect(() => {
    const controller = new AbortController();
    void eachSent(
      (signal) =>
        rpcClient.browser.events.openInNewTab.call(undefined, { signal }),
      controller.signal,
      (ask) => {
        openers.current.openFromPage(ask);
      },
    );
    return () => {
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const controller = new AbortController();
    void eachSent(
      (signal) =>
        rpcClient.workspace.window.events.tab.call(undefined, { signal }),
      controller.signal,
      async (request) => {
        const answer = await openers.current.actOnTab(request);
        // The answer goes back to the command that asked, so the
        // conversation can hand a tab to a task, or say what went wrong,
        // without waiting for the next message's note.
        void rpcClient.workspace.window.tabDone.call({
          requestId: request.requestId,
          ...answer,
        });
      },
    );
    return () => {
      controller.abort();
    };
  }, [isOpen]);
  // Steady, so what they are handed to (the command menu, every screen's
  // window context) is not drawn again each time the window is.
  return useSteadyCallbacks({
    openNamedPath,
    openPage,
    openScreen: (href: string, options?: OpenOptions) => {
      openScreen(href, options);
    },
  });
}

/** Says a chat's address named none of the chats here. */
function sayNoChat() {
  toast("No chat at that address", {
    description: "It may have been deleted, or the link is not for this chat.",
  });
}

/**
 * Hands on each thing an event stream sends, one at a time, until the stream
 * ends or `signal` stops it.
 */
async function eachSent<T>(
  start: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
  signal: AbortSignal,
  onEach: (sent: T) => Promise<void> | void,
) {
  try {
    for await (const sent of await start(signal)) {
      await onEach(sent);
    }
  } catch {
    // The window closing ends the stream.
  }
}
