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
import { keptInOtherWindows } from "@/client/lib/kept-state";
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
  selectOrAddTab,
  selectTab,
  setTabPathname,
} from "@/client/lib/tabs-model";
import { APP_TABS_KEY } from "@/shared/kept-state";
import { asksMoreThan, tabIdentityOf } from "@/shared/tab-identity";
import { type Tab, type TabsModel, TabsModelSchema } from "@/shared/tabs";
import { rpcClient } from "@/client/rpc/client";
import { folderHref } from "@/shared/computer-href";
import { draftGroupOf } from "@/shared/drafts";
import { type TabId } from "@/shared/tabs";
import { type ChatId } from "@instrument-org/workspace/client";
import { safe } from "@orpc/client";
import { atom, getDefaultStore, useAtom, useAtomValue, useStore } from "jotai";

import { openLinkAddress } from "./open-link-address";
import {
  chatHref,
  chatOfGroup,
  chatOfHref,
  matchScreen,
  pathOf,
  SCREEN_ROUTES,
  showsSame,
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

/**
 * Whether a closed tab is a site with no page left to give it, as one closed before
 * this launch or in another renderer is.
 */
export function isGoneSite(
  { pathname }: { pathname: string },
  putAway: Record<string, WindowTab[]>,
) {
  const group = isSiteHref(pathname) ? groupOfHref(pathname) : undefined;
  return group !== undefined && !putAway[group];
}

/** A fresh group for a site opened at the window's own level. */
export function newSiteGroup(): string {
  return siteGroupOf(crypto.randomUUID());
}

/** Addresses in a window of their own beside this one, each a tab, the first up. */
export function openInNewWindow(...hrefs: string[]) {
  void rpcClient.window.openNew.call({
    tabs: hrefs.map((pathname) => ({ id: freshTabId(), pathname })),
  });
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
export const appTabsAtom = tabsAtomOf(APP_TABS_KEY, INBOX_HREF);

/**
 * The group of a chat's tabs or a site's page an app tab's address stands
 * on: the chat's id for a chat, the draft's group for a new chat being
 * written in the Chat screen, the site's group for a site, and none for
 * everything else, whose screen is the route itself.
 */
export function groupOfHref(href: string): string | undefined {
  const screen = matchScreen(href);
  switch (screen.kind) {
    case "chat": {
      return screen.chat;
    }
    case "inbox": {
      return screen.draft === undefined
        ? undefined
        : draftGroupOf(screen.draft);
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

/** The sites' groups among some addresses. */
export function siteGroupsOf(hrefs: readonly string[]) {
  return hrefs.flatMap((href) => {
    const group = groupOfHref(href);
    return group !== undefined && isSiteGroup(group) ? [group] : [];
  });
}

/**
 * The sites' groups a tab in another window stands on, closed windows that can
 * come back included. A tab another window closed is not one of them: that
 * window has let go of its page, and keeps what it needs to bring it back.
 */
export function siteGroupsInOtherWindows() {
  const models = keptInOtherWindows(APP_TABS_KEY).flatMap((value) => {
    const model = TabsModelSchema.safeParse(value);
    return model.success ? [model.data] : [];
  });
  return new Set(
    models.flatMap((model) =>
      model.tabs.flatMap((tab) =>
        siteGroupsOf([...(tab.history?.entries ?? []), tab.pathname]),
      ),
    ),
  );
}

/**
 * The tab of a window's strip showing what an address shows (`showsSame`):
 * the one up when it does, else the first.
 */
function stripTabShowing(model: TabsModel, href: string): Tab | undefined {
  const up = model.tabs.find((tab) => tab.id === model.selectedId);
  if (up && showsSame(up.pathname, href)) {
    return up;
  }
  return model.tabs.find((tab) => showsSame(tab.pathname, href));
}

/** Whether a tab of another window's strip shows what an address shows, by what each window keeps. */
function isShownInOtherWindow(href: string) {
  return keptInOtherWindows(APP_TABS_KEY).some((value) => {
    const model = TabsModelSchema.safeParse(value);
    return (
      model.success &&
      model.data.tabs.some((tab) => showsSame(tab.pathname, href))
    );
  });
}

type Store = ReturnType<typeof getDefaultStore>;

/**
 * Walks a tab to an address, a step on in its history: by its router, or,
 * for a tab restored and never shown, which has none yet, in what the tab
 * keeps, which its router starts from when it comes up.
 */
function walkTab(store: Store, tab: Tab, href: string) {
  const router = getTabRouter(tab.id);
  if (router) {
    router.history.push(href);
    return;
  }
  const { entries, index } = tab.history ?? {
    entries: [tab.pathname],
    index: 0,
  };
  const history = {
    entries: [...entries.slice(0, index + 1), href],
    index: index + 1,
  };
  store.set(appTabsAtom, (model) =>
    setTabPathname(model, { history, id: tab.id, pathname: href }),
  );
}

/**
 * Brings up this window's tab already showing what an address shows, and
 * walks it there when the address asks more of it than it shows
 * (`asksMoreThan`: a selection, the notes since a version). False where no
 * tab here shows it. `select: false` leaves the tab found where it is.
 */
function showTabHere(
  href: string,
  {
    select = true,
    store = getDefaultStore(),
  }: { select?: boolean; store?: Store } = {},
): boolean {
  const current = store.get(appTabsAtom);
  const here = stripTabShowing(current, href);
  if (!here) {
    return false;
  }
  if (select && current.selectedId !== here.id) {
    store.set(appTabsAtom, (model) => selectTab(model, { id: here.id }));
  }
  if (asksMoreThan(href, here.pathname)) {
    walkTab(store, here, href);
  }
  return true;
}

/**
 * Opening something with one identity where a tab already shows it: that
 * tab comes forward (`showTabHere`), this window's first, then another
 * window's, which comes forward with it once it says it has the tab (main
 * asks it, by the same identity). Only where none does is `otherwise` run,
 * which opens it. Every open of a window tab that is not an explicit new tab
 * or new window, nor one the app makes on its own, goes through here.
 */
export function showTabOr(
  href: string,
  otherwise: () => void,
  {
    select = true,
    store = getDefaultStore(),
  }: {
    select?: boolean;
    store?: Store;
  } = {},
) {
  // A site, the web's start or a new tab is not one of a kind, and opens
  // as it always has.
  if (tabIdentityOf(href) === undefined) {
    otherwise();
    return;
  }
  if (showTabHere(href, { select, store })) {
    return;
  }
  if (!isShownInOtherWindow(href)) {
    otherwise();
    return;
  }
  // What another window keeps includes windows closed that can come back,
  // which main does not count, so a tab only one of those has opens here.
  void safe(rpcClient.window.showInOtherWindow.call({ href })).then(
    ([error, shown]) => {
      if (error || !shown) {
        otherwise();
      }
    },
  );
}

/**
 * The window's tabs and what can be done with them. Navigation inside a tab
 * is its router's; everything about the set of tabs (which is up, their
 * order, opening and closing) is the model's.
 */
export function useAppTabs() {
  const store = useStore();
  const [model, setModel] = useAtom(appTabsAtom);
  const putAwaySites = useAtomValue(putAwaySitesAtom);
  const lastChat = useAtomValue(chatGroupAtom);
  const lastFolder = useAtomValue(filesHrefAtom);
  const activeRouter = getTabRouter(model.selectedId);

  /**
   * A tab at an address, up at once unless asked to wait behind: the one
   * already showing what it shows (`showTabOr`), or a tab of its own, which
   * `newTab` always opens, for a Cmd-click or Open in New Tab. A link address
   * opens where it lives instead (`openLinkAddress`).
   */
  const open = (
    href: string,
    {
      newTab = false,
      select = true,
    }: { newTab?: boolean; select?: boolean } = {},
  ) => {
    const at = openLinkAddress(href);
    if (at === undefined) {
      return;
    }
    const add = () => {
      setModel((current) =>
        addTab(current, { id: freshTabId(), pathname: at, select }),
      );
    };
    if (newTab) {
      add();
    } else {
      showTabOr(at, add, { select, store });
    }
  };
  /** The tab up goes to an address, one step on in its history; a link address opens where it lives instead. */
  const navigate = (to: string, { replace = false } = {}) => {
    const href = openLinkAddress(to);
    if (href === undefined) {
      return;
    }
    if (!activeRouter) {
      open(href, { newTab: true });
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
  const goHere = (href: string, { behind = false, newTab = false } = {}) => {
    if (newTab) {
      open(href, { newTab: true, select: !behind });
    } else {
      navigate(href);
    }
  };
  /**
   * As `goHere`, except that the tab already showing what the address shows
   * comes forward rather than the tab up going there (`showTabOr`).
   */
  const go = (href: string, { behind = false, newTab = false } = {}) => {
    if (newTab) {
      goHere(href, { behind, newTab });
      return;
    }
    const at = openLinkAddress(href);
    if (at !== undefined) {
      showTabOr(
        at,
        () => {
          navigate(at);
        },
        { store },
      );
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
      { behind = false, newTab = false, newWindow = false, root = false } = {},
    ) => {
      const href = placeHrefOf(place, {
        lastChat: root ? null : lastChat,
        lastFolder: root ? folderHref("~") : lastFolder,
      });
      if (newWindow) {
        openInNewWindow(href);
        return;
      }
      // A place is where the tab up goes, whatever another tab shows there.
      goHere(href, {
        behind,
        newTab,
      });
    },
    model,
    navigate,
    open,
    /**
     * Brings up the tab that has a chat, or a new one at it. Decided from the
     * tabs as they stand at the call rather than as this render saw them, so a
     * caller holding an older render cannot open a second.
     */
    openOrFocusChat: (chatId: ChatId) => {
      setModel((current) =>
        selectOrAddTab(current, {
          id: freshTabId(),
          matches: (tab) => chatOfHref(tab.pathname) === chatId,
          pathname: chatHref(chatId),
        }),
      );
    },
    /** A new tab: the command menu, until something is picked there. */
    openNewTab: () => {
      open(NEW_TAB_HREF);
    },
    // Whichever closed last, this window's tab or a whole window, the way a
    // browser's one chord brings back either.
    reopen: () => {
      // A site no record is left of has nothing to come back to, here as in the menu.
      const tab = model.recentlyClosed.find(
        (each) => !isGoneSite(each, putAwaySites),
      );
      void rpcClient.window.reopenClosed
        .call(tab && { after: tab.closedAt ?? 0 })
        .catch(() => false)
        .then((windowCameBack) => {
          if (tab && !windowCameBack) {
            setModel((current) =>
              reopenClosed(current, {
                entry: current.recentlyClosed.findIndex(
                  (each) => each.id === tab.id,
                ),
                id: freshTabId(),
              }),
            );
          }
        });
    },
    /**
     * The next or previous row of the inbox from the chat up, or from no
     * chat the list's first or last, in the tab up: the chord steps in
     * place, whatever another tab or window has the chat.
     */
    stepChat: (
      listed: readonly ChatId[],
      from: ChatId | undefined,
      direction: -1 | 1,
    ) => {
      const at = from === undefined ? -1 : listed.indexOf(from);
      const next =
        at === -1
          ? direction === 1
            ? listed[0]
            : listed.at(-1)
          : listed[at + direction];
      if (next !== undefined) {
        navigate(chatHref(next));
      }
    },
    /** This window's tab already showing what an address shows, up and walked there (`showTabHere`); false where none does. */
    selectShowing: (href: string): boolean => showTabHere(href, { store }),
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
