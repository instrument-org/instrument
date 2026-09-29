import {
  type AppPlace,
  APPS_HREF,
  chatGroupAtom,
  CHATS_HREF,
  NEW_TAB_HREF,
  WEB_HREF,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { tabsAtomOf } from "@/client/atoms/tabs";
import { freshTabId } from "@/client/lib/tab-actions";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import {
  addTab,
  closeTab,
  reopenClosed,
  reorderTabs,
  selectAdjacent,
  selectByIndex,
  selectTab,
  type TabsModel,
} from "@/client/lib/tabs-model";
import { instrumentFolderHref } from "@/shared/computer-href";
import { type Tab, type TabId } from "@/shared/tabs";
import { StoreId } from "@instrument-org/workspace/client";
import { atom, useAtom, useAtomValue } from "jotai";

import { IDEAS_HREF } from "./ideas";
import { chatOfHref, parseHref } from "./window-tabs";

/** The chat with no chat open: the inbox, and where every new tab opens. */
export const CHAT_HREF = "/orchestrator";

/** The route of a site opened at the window's own level, which draws the page group its address names. */
export const PAGE_HREF = "/orchestrator/page";

/** Whether a group is a site opened at the window's own level, whose back past its page is the window tab's. */
export function isSiteGroup(group: string | undefined): boolean {
  return group?.startsWith("site:") ?? false;
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
  return `${PAGE_HREF}?group=${encodeURIComponent(group)}`;
}

/** The group key a site opened at the window's own level is kept under, one per site opened. */
function siteGroupOf(id: string): string {
  return `site:${id}`;
}

/**
 * The window's tabs, across its bar: each one a chat, a folder or file, the
 * apps or an app, Discover, or a site, kept across launches with each tab's
 * own history.
 */
export const appTabsAtom = tabsAtomOf(
  "orchestrator.app-tabs.v1",
  CHAT_HREF,
  withoutNewTabPage,
);

/**
 * The window's tabs with the new-tab page, which is a draft's own face and
 * no route of the window's, read as the inbox wherever a tab stands on it
 * or has been at it.
 */
export function withoutNewTabPage(model: TabsModel): TabsModel {
  const fix = (href: string) =>
    href.split(/[?#]/)[0] === NEW_TAB_HREF ? CHAT_HREF : href;
  const fixTab = (tab: Tab): Tab => ({
    ...tab,
    pathname: fix(tab.pathname),
    ...(tab.history
      ? { history: { ...tab.history, entries: tab.history.entries.map(fix) } }
      : {}),
  });
  return {
    ...model,
    recentlyClosed: model.recentlyClosed.map(fixTab),
    tabs: model.tabs.map(fixTab),
  };
}

/**
 * The group of a chat's tabs or a site's page an app tab's address stands
 * on: the chat's session for a chat, the site's group for a site, and none
 * for everything else, whose screen is the route itself.
 */
export function groupOfHref(href: string): string | undefined {
  const chat = chatOfHref(href);
  if (chat) {
    return chat;
  }
  const { pathname, search } = parseHref(href);
  return pathname === PAGE_HREF
    ? (search.get("group") ?? undefined)
    : undefined;
}

/** Whether an address is the chat: the inbox alone, or beside a chat. */
export function isChatHref(href: string): boolean {
  const { pathname } = parseHref(href);
  return (
    pathname.replace(/\/$/, "") === CHAT_HREF ||
    pathname.startsWith(`${CHATS_HREF}/`)
  );
}

/** The place of the rail an address is in, for lighting it; none for a screen outside them. */
export function placeOfHref(href: string): AppPlace | undefined {
  if (isChatHref(href)) {
    return "chat";
  }
  const { pathname } = parseHref(href);
  if (pathname === "/orchestrator/computer") {
    return "files";
  }
  if (pathname === WEB_HREF || pathname === PAGE_HREF) {
    return "browser";
  }
  if (pathname === APPS_HREF || pathname.startsWith(`${APPS_HREF}/`)) {
    return "apps";
  }
  if (pathname === IDEAS_HREF || pathname.startsWith(`${IDEAS_HREF}/`)) {
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
    CHAT_HREF;
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
  /** Goes to an address in the tab up, or in a tab of its own when asked. */
  const go = (href: string, { newTab = false } = {}) => {
    if (newTab) {
      open(href);
    } else {
      navigate(href);
    }
  };
  const close = (id: TabId) => {
    setModel((current) =>
      closeTab(current, {
        id,
        newTab: { id: freshTabId(), pathname: CHAT_HREF },
      }),
    );
  };
  return {
    activeRouter,
    close,
    go,
    goToPlace: (place: AppPlace, { newTab = false } = {}) => {
      go(placeHrefOf(place, lastChat), { newTab });
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
      return WEB_HREF;
    }
    case "chat": {
      const chat = StoreId.SessionSchema.safeParse(lastChat);
      return chat.success ? `${CHATS_HREF}/${chat.data}` : CHAT_HREF;
    }
    case "discover": {
      return IDEAS_HREF;
    }
    case "files": {
      return instrumentFolderHref();
    }
  }
}
