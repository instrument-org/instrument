import { tabsAtomOf } from "@/client/atoms/tabs";
import {
  type AppPlace,
  APPS_HREF,
  BROWSER_HREF,
  chatGroupAtom,
  filesHrefAtom,
  NEW_TAB_HREF,
  type WindowTab,
} from "@/client/atoms/window";
import { freshTabId } from "@/client/lib/tab-actions";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import {
  addTab,
  closeOtherTabs,
  closeTab,
  closeTabsToRight,
  duplicateTab,
  reopenClosed,
  reorderTabs,
  selectAdjacent,
  selectByIndex,
  selectTab,
} from "@/client/lib/tabs-model";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { type TabId } from "@/shared/tabs";
import { atom, useAtom, useAtomValue } from "jotai";

import { openLinkAddress } from "./open-link-address";
import {
  chatHref,
  chatOfGroup,
  matchScreen,
  pathOf,
  SCREEN_ROUTES,
} from "./window-href";

/** The chat with no chat open: the inbox, and where a tab opens when the last one closes. */
export const INBOX_HREF = "/chats";

/** What a site's group key starts with, before the id its route carries. */
const SITE_PREFIX = "site:";

/** Whether a group is a site opened at the window's own level, whose back past its page is the window tab's. */
export function isSiteGroup(group: string | undefined): boolean {
  return group?.startsWith(SITE_PREFIX) ?? false;
}

/** Whether an address is a site opened at the window's own level. */
export function isSiteHref(href: string): boolean {
  return matchScreen(href).kind === "site";
}

/**
 * The pages of sites whose tabs were closed, by their group, kept for this
 * launch so a tab reopened with Shift+Cmd+T gets its page back at the
 * address it had, while the page itself (its guest, its sound) is gone.
 */
export const putAwaySitesAtom = atom<Record<string, WindowTab[]>>({});

/** A fresh group for a site opened at the window's own level. */
export function newSiteGroup(): string {
  return siteGroupOf(crypto.randomUUID());
}

/** The address of the tab that shows a site's group. */
export function pageHrefOf(group: string): string {
  return pathOf(SCREEN_ROUTES.site, { id: group.slice(SITE_PREFIX.length) });
}

/** The group key a site opened at the window's own level is kept under, one per site opened. */
export function siteGroupOf(id: string): string {
  return `${SITE_PREFIX}${id}`;
}

/**
 * The window's tabs, across its bar: each one a chat, a folder or file, the
 * apps or an app, or a site, kept across launches with each tab's
 * own history.
 */
export const appTabsAtom = tabsAtomOf("app-tabs.v2", INBOX_HREF);

/**
 * The group of a chat's tabs or a site's page an app tab's address stands
 * on: the chat's id for a chat, the site's group for a site, and none
 * for everything else, whose screen is the route itself.
 */
export function groupOfHref(href: string): string | undefined {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "chat": {
      return screen.chat;
    }
    case "site": {
      return siteGroupOf(screen.id);
    }
    default: {
      return undefined;
    }
  }
}

/** Whether an address is the chat: the inbox alone, or beside a chat. */
export function isChatHref(href: string): boolean {
  switch (matchScreen(href).kind) {
    case "chat":
    case "chatLink":
    case "chatOfSession":
    case "inbox": {
      return true;
    }
    default: {
      return false;
    }
  }
}

/** The place of the rail an address is in, for lighting it; none for a screen outside them. */
export function placeOfHref(href: string): AppPlace | undefined {
  if (isChatHref(href)) {
    return "chat";
  }
  switch (matchScreen(href).kind) {
    case "computer": {
      return "files";
    }
    case "browser":
    case "site": {
      return "browser";
    }
    case "app":
    case "apps": {
      return "apps";
    }
    default: {
      return undefined;
    }
  }
}

/**
 * The window's tabs and what can be done with them. Navigation inside a tab
 * is its router's; everything about the set of tabs (which is up, their
 * order, opening and closing) is the model's.
 */
export function useAppTabs() {
  const [model, setModel] = useAtom(appTabsAtom);
  const lastChat = useAtomValue(chatGroupAtom);
  const lastFolder = useAtomValue(filesHrefAtom);
  const activeRouter = getTabRouter(model.selectedId);

  /**
   * A tab of its own at an address, up at once unless asked to wait behind.
   * A link address opens where it lives instead (`openLinkAddress`).
   */
  const open = (href: string, { select = true }: { select?: boolean } = {}) => {
    const at = openLinkAddress(href);
    if (at === undefined) {
      return;
    }
    setModel((current) =>
      addTab(current, { id: freshTabId(), pathname: at, select }),
    );
  };
  /** The tab up goes to an address, one step on in its history; a link address opens where it lives instead. */
  const navigate = (to: string, { replace = false } = {}) => {
    const href = openLinkAddress(to);
    if (href === undefined) {
      return;
    }
    if (!activeRouter) {
      open(href);
      return;
    }
    if (activeRouter.history.location.href === href) {
      return;
    }
    if (replace) {
      activeRouter.history.replace(href);
    } else {
      activeRouter.history.push(href);
    }
  };
  /** Goes to an address in the tab up, or in a tab of its own when asked, which waits behind when asked to. */
  const go = (href: string, { behind = false, newTab = false } = {}) => {
    if (newTab) {
      open(href, { select: !behind });
    } else {
      navigate(href);
    }
  };
  const closeInModel = (id: TabId) => {
    setModel((current) =>
      closeTab(current, {
        id,
        newTab: { id: freshTabId(), pathname: INBOX_HREF },
      }),
    );
  };
  const close = (id: TabId) => {
    if (model.tabs.length !== 1 || model.tabs[0]?.id !== id) {
      closeInModel(id);
      return;
    }
    // The last tab closing closes the window, which quits the app outside
    // macOS once the person has said yes about running work. Only then does
    // the tab go, leaving the inbox for the next window; a canceled quit
    // leaves the window as it was.
    void rpcClient.utils.approveWindowClose.call().then(({ approved }) => {
      if (approved) {
        closeInModel(id);
        void rpcClient.utils.closeWindow.call();
      }
    });
  };
  return {
    activeRouter,
    close,
    closeOthers: (id: TabId) => {
      setModel((current) => closeOtherTabs(current, { id }));
    },
    closeToRight: (id: TabId) => {
      setModel((current) => closeTabsToRight(current, { id }));
    },
    /** A copy of the tab beside it, up; at `pathname` for a copy that needs a place of its own. */
    duplicate: (id: TabId, pathname?: string) => {
      setModel((current) =>
        duplicateTab(current, {
          id,
          newId: freshTabId(),
          ...(pathname === undefined ? {} : { pathname }),
        }),
      );
    },
    go,
    /** The tab up to a place, at the chat or folder it last had open unless asked for the place's root. */
    goToPlace: (
      place: AppPlace,
      { behind = false, newTab = false, root = false } = {},
    ) => {
      go(
        placeHrefOf(place, {
          lastChat: root ? null : lastChat,
          lastFolder: root ? folderHref("~") : lastFolder,
        }),
        {
          behind,
          newTab,
        },
      );
    },
    model,
    navigate,
    open,
    /** A new tab: the command menu, until something is picked there. */
    openNewTab: () => {
      open(NEW_TAB_HREF);
    },
    reopen: () => {
      setModel((current) => reopenClosed(current, { id: freshTabId() }));
    },
    reorder: (ids: TabId[]) => {
      setModel((current) => reorderTabs(current, { ids }));
    },
    select: (id: TabId) => {
      setModel((current) => selectTab(current, { id }));
    },
    /** A tab by its place in the strip, counted from one; nine is the last. */
    selectIndex: (index: number) => {
      setModel((current) =>
        selectByIndex(current, {
          index: index >= 9 ? current.tabs.length - 1 : index - 1,
        }),
      );
    },
    selectRelative: (delta: -1 | 1) => {
      setModel((current) => selectAdjacent(current, { delta }));
    },
  };
}

/**
 * Where the rail takes a tab for a place: the chat at the one it last had
 * open, Files at the folder it last stood in, the browser's start, and the
 * apps. With no chat named, the chat is the inbox.
 */
function placeHrefOf(
  place: AppPlace,
  { lastChat, lastFolder }: { lastChat: null | string; lastFolder: string },
): string {
  switch (place) {
    case "apps": {
      return APPS_HREF;
    }
    case "browser": {
      return BROWSER_HREF;
    }
    case "chat": {
      const chat = chatOfGroup(lastChat ?? undefined);
      return chat ? chatHref(chat) : INBOX_HREF;
    }
    case "files": {
      return lastFolder;
    }
  }
}
