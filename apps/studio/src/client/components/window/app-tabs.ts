import { tabsAtomOf } from "@/client/atoms/tabs";
import {
  type AppPlace,
  APPS_HREF,
  BROWSER_HREF,
  chatGroupAtom,
  CHATS_HREF,
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
  type TabsModel,
} from "@/client/lib/tabs-model";
import { rpcClient } from "@/client/rpc/client";
import { instrumentFolderHref } from "@/shared/computer-href";
import { type TabId } from "@/shared/tabs";
import { atom, useAtom, useAtomValue } from "jotai";

import { DISCOVER_HREF } from "./ideas";
import { chatOfGroup, chatOfHref, parseHref } from "./window-href";

/** The chat with no chat open: the inbox, and where every new tab opens. */
export const INBOX_HREF = "/chats";

/** The route of the sites opened at the window's own level, each followed by the id its page group is kept under. */
const SITES_HREF = "/sites";

/** What a site's group key starts with, before the id its route carries. */
const SITE_PREFIX = "site:";

/** Whether a group is a site opened at the window's own level, whose back past its page is the window tab's. */
export function isSiteGroup(group: string | undefined): boolean {
  return group?.startsWith(SITE_PREFIX) ?? false;
}

/** Whether an address is a site opened at the window's own level. */
export function isSiteHref(href: string): boolean {
  return parseHref(href).pathname.startsWith(`${SITES_HREF}/`);
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
  return `${SITES_HREF}/${encodeURIComponent(group.slice(SITE_PREFIX.length))}`;
}

/** The group key a site opened at the window's own level is kept under, one per site opened. */
function siteGroupOf(id: string): string {
  return `${SITE_PREFIX}${id}`;
}

/**
 * The window's tabs, across its bar: each one a chat, a folder or file, the
 * apps or an app, Discover, or a site, kept across launches with each tab's
 * own history.
 */
export const appTabsAtom = tabsAtomOf("studio.app-tabs.v2", INBOX_HREF);

/**
 * The group of a chat's tabs or a site's page an app tab's address stands
 * on: the chat's id for a chat, the site's group for a site, and none
 * for everything else, whose screen is the route itself.
 */
export function groupOfHref(href: string): string | undefined {
  const chat = chatOfHref(href);
  if (chat) {
    return chat;
  }
  const { pathname } = parseHref(href);
  return isSiteHref(href)
    ? siteGroupOf(decodeURIComponent(pathname.slice(SITES_HREF.length + 1)))
    : undefined;
}

/** Where one of the window's tabs stands: its router's address once it has one, the address it opened at until then. */
export function hrefOfAppTab(model: TabsModel, id: TabId): string | undefined {
  return (
    getTabRouter(id)?.history.location.href ??
    model.tabs.find((tab) => tab.id === id)?.pathname
  );
}

/** Whether an address is the chat: the inbox alone, or beside a chat. */
export function isChatHref(href: string): boolean {
  const { pathname } = parseHref(href);
  return (
    pathname.replace(/\/$/, "") === INBOX_HREF ||
    pathname.startsWith(`${CHATS_HREF}/`)
  );
}

/** The place of the rail an address is in, for lighting it; none for a screen outside them. */
export function placeOfHref(href: string): AppPlace | undefined {
  if (isChatHref(href)) {
    return "chat";
  }
  const { pathname } = parseHref(href);
  if (pathname === "/files") {
    return "files";
  }
  if (pathname === BROWSER_HREF || isSiteHref(href)) {
    return "browser";
  }
  if (pathname === APPS_HREF || pathname.startsWith(`${APPS_HREF}/`)) {
    return "apps";
  }
  if (pathname === DISCOVER_HREF || pathname.startsWith(`${DISCOVER_HREF}/`)) {
    return "discover";
  }
  return undefined;
}

/**
 * The window's tabs and what can be done with them. Navigation inside a tab
 * is its router's; everything about the set of tabs (which is up, their
 * order, opening and closing) is the model's.
 */
export function useAppTabs() {
  const [model, setModel] = useAtom(appTabsAtom);
  const lastChat = useAtomValue(chatGroupAtom);
  const activeRouter = getTabRouter(model.selectedId);

  /** Where the tab up stands. */
  const hrefOfSelected = () =>
    activeRouter?.history.location.href ??
    model.tabs.find((tab) => tab.id === model.selectedId)?.pathname ??
    INBOX_HREF;
  /** A tab of its own at an address, up at once unless asked to wait behind. */
  const open = (href: string, { select = true }: { select?: boolean } = {}) => {
    setModel((current) =>
      addTab(current, { id: freshTabId(), pathname: href, select }),
    );
  };
  /** The tab up goes to an address, one step on in its history. */
  const navigate = (href: string, { replace = false } = {}) => {
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
    // The last tab closing quits the app on every platform, once the person
    // has said yes about running agents. Only then does the tab go, leaving
    // the inbox for next launch; a canceled quit leaves the window as it was.
    void rpcClient.utils.approveQuit.call().then(({ approved }) => {
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
    goToPlace: (place: AppPlace, { behind = false, newTab = false } = {}) => {
      go(placeHrefOf(place, lastChat), { behind, newTab });
    },
    /** A new tab of the place the tab up stands in, or of the chat outside any place. */
    model,
    navigate,
    open,
    openNewTab: () => {
      const href = hrefOfSelected();
      open(placeHrefOf(placeOfHref(href) ?? "chat", null));
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
 * open, the computer at the Instrument folder, the browser's start, the
 * apps, and Discover. With no chat named, the chat is the inbox, which is
 * where a new tab of the chat opens.
 */
function placeHrefOf(place: AppPlace, lastChat: null | string): string {
  switch (place) {
    case "apps": {
      return APPS_HREF;
    }
    case "browser": {
      return BROWSER_HREF;
    }
    case "chat": {
      const chat = chatOfGroup(lastChat ?? undefined);
      return chat ? `${CHATS_HREF}/${chat}` : INBOX_HREF;
    }
    case "discover": {
      return DISCOVER_HREF;
    }
    case "files": {
      return instrumentFolderHref();
    }
  }
}
