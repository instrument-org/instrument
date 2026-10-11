import { openSettings } from "@/client/atoms/settings-modal";
import { openShortcutGuide } from "@/client/atoms/shortcut-guide-modal";
import { CHATS_HREF } from "@/client/atoms/window";
import { takeKeyboardOnArrival } from "@/client/lib/browser-pool";
import { rpcClient } from "@/client/rpc/client";
import { fileHref, folderHref } from "@/shared/computer-href";
import { isScreenName, SCREENS } from "@/shared/instrument-screens";
import {
  type ChatId,
  encodeBrowserTargetId,
  isFolderPath,
  StoreId,
  WINDOW_ID,
  type WindowTabAnswer,
  type WindowTabRequest,
} from "@instrument-org/workspace/client";
import { APP_NAME } from "@instrument-org/shared";
import { safe } from "@orpc/client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "@/client/lib/toast";

import { newSiteGroup, pageHrefOf, type useAppTabs } from "./app-tabs";
import { type BrowserTabsHandle } from "./browser-tabs";
import { type Chat } from "./chats";
import { type OpenOptions } from "./context";
import { openMenuLink } from "./menu-link";
import {
  chatOfAskingPage,
  pagePlacementOf,
  type PlacementContext,
  screenPlacementOf,
  tasksPlacementOf,
} from "./placement";
import { visitInTab } from "./tab-history";
import {
  memoryOfHref,
  screenOfHref,
  settingOfHref,
  skillOfHref,
  taskHref,
  tasksHref,
  tasksOfHref,
} from "./tab-location";
import { isFreshTab } from "./tab-model";
import {
  chatOfGroup,
  chatOfHref,
  chatOfHrefPrefix,
  chatOfSessionPrefix,
  chatSessionOfHref,
  parseHref,
} from "./window-href";
import { newScreenId, type useWindowTabs } from "./window-tabs";

/**
 * What the conversation asks to open, as it asks: a page as a tab, a path
 * of the user's as the tab that shows it. The openers are read at the moment
 * of each ask, since they close over the tabs as they are then.
 */
export function useOpeners({
  appTabs,
  browser,
  chats,
  chatTitles,
  isOpen,
  revealPane,
  setPaneOpen,
  windowTabs,
}: {
  /** The window's tabs: what is not a chat's opens by moving the tab up, or in a tab of its own. */
  appTabs: ReturnType<typeof useAppTabs>;
  /** The window's browser; null until it is mounted. */
  browser: BrowserTabsHandle | null;
  /** The chats the window has, once the list has been read. */
  chats: Chat[] | undefined;
  chatTitles: Map<ChatId, string>;
  /** Whether what the window opens on is made; nothing is opened before it is. */
  isOpen: boolean;
  /** Brings the pane up for the group on screen, for something opened into it. */
  revealPane: () => void;
  setPaneOpen: (group: string, isOpen: boolean) => void;
  windowTabs: ReturnType<typeof useWindowTabs>;
}) {
  const queryClient = useQueryClient();
  const { active } = windowTabs;
  /** The window as an open is placed against, read at the ask. */
  const placing: PlacementContext = {
    groupOnScreen: windowTabs.groupOnScreen,
    isChatOnScreen: chatOfGroup(windowTabs.groupOnScreen) !== undefined,
    up: active && {
      isFresh: isFreshTab(active),
      kind: active.kind,
    },
  };
  /**
   * Brings a chat on screen for something shown into its group from outside
   * it, a row's file in the inbox with another chat up or none: the group
   * on screen follows the tab up, so the tab goes to the chat, or what was
   * shown waits in a group nobody is looking at.
   */
  const goToChatOf = (into: string) => {
    const chat = chatOfGroup(into);
    if (chat) {
      appTabs.go(`${CHATS_HREF}/${chat}`);
    }
  };
  /**
   * Opens a page: in the tab on screen when it is a page of the window's
   * own, in a tab of its own when asked for one, and into a named group when
   * the open belongs to a chat other than the one up, where it waits
   * behind. Opened into the group on screen, it brings the pane up.
   */
  const openPage = (url: string, options: OpenOptions = {}) => {
    const placement = pagePlacementOf(options, placing);
    switch (placement.kind) {
      case "group-behind": {
        const { activate, group, show } = placement;
        if (show) {
          goToChatOf(group);
        }
        const id = browser?.openOrFocus(url, { group, show });
        if (show) {
          setPaneOpen(group, true);
        } else if (activate && id !== undefined) {
          windowTabs.select(id);
        }
        return id;
      }
      case "navigate-up": {
        revealPane();
        browser?.navigate(url);
        return active?.id;
      }
      case "new-page": {
        revealPane();
        const replacing =
          placement.replacesUp && active ? { replacing: active } : undefined;
        const id = browser?.open(url, replacing);
        // A page taking the place of what the person was in takes the
        // keyboard with it; one an agent asked for a tab of its own does not.
        if (replacing && !options.ownTab && id !== undefined) {
          takeKeyboardOnArrival(
            encodeBrowserTargetId(WINDOW_ID, StoreId.SessionSchema.parse(id)),
          );
        }
        return id;
      }
      case "own-tab": {
        revealPane();
        return browser?.openOrFocus(url);
      }
      case "window-site": {
        // The site is the window tab's page, and back from it returns here,
        // unless the screen was only handing its file over, in which case
        // the page takes its place.
        const group = newSiteGroup();
        const id = browser?.open(url, { group });
        appTabs.navigate(pageHrefOf(group), { replace: placement.replace });
        if (!options.ownTab && id !== undefined) {
          takeKeyboardOnArrival(
            encodeBrowserTargetId(WINDOW_ID, StoreId.SessionSchema.parse(id)),
          );
        }
        return id;
      }
      case "window-tab": {
        const group = newSiteGroup();
        const id = browser?.open(url, { group });
        appTabs.open(pageHrefOf(group), { select: !placement.behind });
        return id;
      }
    }
  };
  const openScreen = (href: string, options: OpenOptions = {}): void => {
    const { behind = false, group: into, newTab = false } = options;
    // A chat named by its session, as an older reply's link or a memory
    // saved then names it, opens at the chat that session is.
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
            openScreen(`${CHATS_HREF}/${chat}`, options);
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
    const chat = chats
      ? (chatOfHrefPrefix(href, chatTitles.keys()) ??
        chatOfSessionPrefix(href, chats))
      : chatOfHref(href);
    if (chat) {
      // A chat is a place a tab stands: the tab up goes there, a step on in
      // its history, and the chat comes up at the tab it last had up.
      appTabs.go(`${CHATS_HREF}/${chat}`, { behind, newTab });
      return;
    }
    if (parseHref(href).pathname.startsWith(`${CHATS_HREF}/`)) {
      // A chat's address that names none of the chats here: a screen
      // at it would be a chat with nothing in it.
      sayNoChat();
      return;
    }
    // A memory is shown where all of them are, in Settings, brought to the
    // one named; a screen of its own would be one memory with nothing to do
    // to it.
    const memory = memoryOfHref(href);
    if (memory) {
      openSettings({ memory, tab: "Memory" });
      return;
    }
    // A skill likewise, in Settings, open on the one named.
    const skill = skillOfHref(href);
    if (skill) {
      openSettings({ skill, tab: "Skills" });
      return;
    }
    // A setting likewise, in Settings, on its page and lit; a name Settings
    // has no row or page for is searched for there instead.
    const setting = settingOfHref(href);
    if (setting) {
      openSettings({ setting });
      return;
    }
    // A screen a reply named opens where it lives: a place at its own
    // address, or a dialog over the window.
    const screen = screenOfHref(href);
    if (screen !== undefined) {
      if (!isScreenName(screen)) {
        sayNoScreen();
        return;
      }
      if (screen === "shortcuts") {
        openShortcutGuide();
      } else {
        openScreen(SCREENS[screen].href, options);
      }
      return;
    }
    // A chat's tasks, or one task, are a tab in the chat's group, a task in
    // the chat it was filed from, with the chat on screen and its pane open.
    // A tasks tab already up in that chat walks there in place, the way its
    // crumbs do; anything else gets the tab at that address, or a new one.
    const tasks = tasksOfHref(href);
    const owner = tasks
      ? chatOfGroup(tasks.chat ?? into ?? windowTabs.groupOnScreen)
      : undefined;
    if (tasks && owner) {
      const at =
        tasks.task === undefined
          ? tasksHref(owner)
          : taskHref(tasks.task, owner);
      const up = windowTabs.selectedTabIn(owner);
      const placement = tasksPlacementOf(owner, options, {
        groupOnScreen: windowTabs.groupOnScreen,
        upInOwner: up?.kind === "screen" ? up.href : undefined,
      });
      if (placement.kind === "in-place") {
        revealPane();
        windowTabs.navigateScreen(at);
        return;
      }
      // In a tab of the window's own, the chat comes up there at its tasks.
      if (placement.navigatesWindow) {
        appTabs.go(`${CHATS_HREF}/${owner}`, { behind, newTab });
      }
      windowTabs.openOrFocusScreen(at, {
        group: owner,
        isOpened: true,
        select: true,
      });
      setPaneOpen(owner, true);
      return;
    }
    const placement = screenPlacementOf(href, options, placing);
    switch (placement.kind) {
      case "group-behind": {
        const { group, select, show } = placement;
        if (show) {
          goToChatOf(group);
        }
        windowTabs.openOrFocusScreen(href, { group, isOpened: true, select });
        if (show) {
          setPaneOpen(group, true);
        }
        return;
      }
      case "group-navigate": {
        // A file opened from a Finder takes the Finder's place in its tab,
        // the way a folder does, and back returns to the folder.
        revealPane();
        windowTabs.navigateScreen(href);
        return;
      }
      case "group-open": {
        revealPane();
        windowTabs.openScreen(href);
        return;
      }
      case "group-own-tab": {
        revealPane();
        windowTabs.openOrFocusScreen(href);
        return;
      }
      case "window-navigate": {
        appTabs.navigate(href);
        return;
      }
      case "window-tab": {
        appTabs.open(href, { select: !placement.behind });
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
   * folder and grants are what `/task` and `/mnt` mean to it. The window's
   * reach reads it where no chat is in view.
   */
  const hrefOfNamedPath = async (
    path: string,
    group: string | undefined,
  ): Promise<string | undefined> => {
    if (!isOpen) {
      return;
    }
    const isFolder = isFolderPath(path);
    const filePath = isFolder ? path.slice(0, -1) : path;
    const [error, hostPaths] = await safe(
      rpcClient.workspace.chats.files.hostPaths.call({
        filePaths: [filePath],
        chatId: chatOfGroup(group ?? windowTabs.groupOnScreen) ?? WINDOW_ID,
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
    void hrefOfNamedPath(path, options?.group).then((href) => {
      if (href !== undefined) {
        openScreen(href, options);
      }
    });
  };
  /**
   * Does what an agent asked of the tabs, and says what came of it: the tab
   * it made or acted on, or why it did nothing. An id is looked up among the
   * tabs of the chat that asked, since those are the tabs its note named.
   */
  const actOnTab = async ({
    action,
    chatId: group,
  }: WindowTabRequest): Promise<Omit<WindowTabAnswer, "requestId">> => {
    if (action.kind === "open") {
      const { target } = action;
      if (target.kind === "page") {
        // A page opened for an agent's own work joins its chat's tabs
        // behind whatever is up; only one the conversation is showing the
        // user comes on screen.
        if (!action.show && group) {
          return { tabId: browser?.openBehind(target.url, group) };
        }
        return target.url === undefined
          ? { error: "a tab on screen needs an address." }
          : {
              tabId: openPage(target.url, {
                ...(group ? { group } : {}),
                ownTab: true,
              }),
            };
      }
      const href = await hrefOfNamedPath(target.mount, group);
      if (href === undefined) {
        return { error: `nothing this window can show is at ${target.mount}.` };
      }
      const into = group ?? windowTabs.groupOnScreen;
      const tabId = windowTabs.openOrFocusScreen(href, {
        ...(into ? { group: into } : {}),
        isOpened: true,
        select: true,
      });
      if (into) {
        setPaneOpen(into, true);
      }
      return { tabId };
    }
    const tab = windowTabs.allTabs.find(
      (entry) =>
        entry.id === action.tabId &&
        (group === undefined || entry.group === group),
    );
    if (!tab) {
      return { error: `no tab ${action.tabId} is open in this chat.` };
    }
    switch (action.kind) {
      case "close": {
        windowTabs.close(tab.id);
        return { tabId: tab.id };
      }
      case "replace": {
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
        const href = await hrefOfNamedPath(target.mount, group);
        if (href === undefined) {
          return {
            error: `nothing this window can show is at ${target.mount}.`,
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
              error: `tab ${tab.id} has no page loaded to read; \`tab show ${tab.id}\` loads it.`,
            }
          : { tabId: tab.id, text };
      }
      case "restore": {
        return browser?.restore(tab.id)
          ? { tabId: tab.id }
          : { error: `tab ${tab.id} is not a page.` };
      }
      case "show": {
        // In front in its chat, with the chat's pane open; the window's own
        // tabs are the person's, so the tab up stays where it is.
        if (tab.group !== undefined) {
          windowTabs.select(tab.id);
          setPaneOpen(tab.group, true);
        }
        return { tabId: tab.id };
      }
    }
  };

  /**
   * A tab a page asked for (a `target=_blank` link, a sign-in button, a
   * middle- or Cmd-click, the page's menu) opens beside the page that asked:
   * in its chat when the page is a chat's, so a sign-in started there stays
   * there, and across the window's own bar otherwise.
   */
  const openFromPage = ({
    background,
    targetId,
    url,
  }: {
    background: boolean;
    targetId: string;
    url: string;
  }) => {
    const chat = chatOfAskingPage(targetId, windowTabs.allTabs);
    if (chat === undefined) {
      openPage(url, { behind: background, newTab: true });
    } else if (background) {
      browser?.openBehind(url, chat);
    } else {
      openPage(url, { group: chat, ownTab: true, show: true });
    }
  };

  const openers = useRef({ actOnTab, openFromPage, openPage });
  useEffect(() => {
    openers.current = { actOnTab, openFromPage, openPage };
  });
  // A link in text being edited, opened from the window's native menu.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const asks = await rpcClient.window.events.openMenuLink.call(
          undefined,
          { signal: controller.signal },
        );
        for await (const ask of asks) {
          openMenuLink(ask);
        }
      } catch {
        // The window closing ends the stream.
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);
  // A link a person asked a page for in a tab of its own.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const asks = await rpcClient.browser.events.openInNewTab.call(
          undefined,
          { signal: controller.signal },
        );
        for await (const ask of asks) {
          openers.current.openFromPage(ask);
        }
      } catch {
        // The window closing ends the stream.
      }
    })();
    return () => {
      controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const asks = await rpcClient.workspace.window.events.tab.call(
          undefined,
          { signal: controller.signal },
        );
        for await (const request of asks) {
          const answer = await openers.current.actOnTab(request);
          // The answer goes back to the command that asked, so the
          // conversation can hand a tab to a task, or say what went wrong,
          // without waiting for the next message's note.
          void rpcClient.workspace.window.tabDone.call({
            requestId: request.requestId,
            ...answer,
          });
        }
      } catch {
        // The window closing ends the stream.
      }
    })();
    return () => {
      controller.abort();
    };
  }, [isOpen]);
  return {
    openNamedPath,
    openPage,
    openScreen: (href: string, options?: OpenOptions) => {
      openScreen(href, options);
    },
  };
}

/** Says a chat's address named none of the chats here. */
function sayNoScreen() {
  toast(`This version of ${APP_NAME} doesn't have that screen`);
}

function sayNoChat() {
  toast("No chat at that address", {
    description: "It may have been deleted, or the link is not for this chat.",
  });
}
