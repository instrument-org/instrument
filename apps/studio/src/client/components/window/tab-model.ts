import {
  type BrowserTab,
  draftOfGroup,
  NEW_TAB_HREF,
  newTabHrefOf,
  type WindowTab,
} from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";

import { groupScreenTabsOnly } from "./group-screen";
import { historyOf, stepTabVisit, visitInTab } from "./tab-history";
import { parseHref, sameHref } from "./window-href";

/**
 * What the window has open: every group's tabs in strip order, and the tab
 * each group has up. A chat's tabs are the ones in its group, a draft's the
 * ones under its key, a site's the one under its own; which group is on
 * screen is not kept here, since it is whatever the window's tab up stands on.
 *
 * Every change to it is one of the functions below, each pure.
 */
export interface WindowTabs {
  /** The tab each group has up, by its key. A group not named has its first tab up. */
  activeByGroup: Record<string, string>;
  tabs: WindowTab[];
}

/**
 * What an earlier build kept: the group on screen and the tab it had up
 * beside the rest, and a screen's steps as a trail with a mark on it.
 * Beta-only: every field here past `WindowTabs` is a 2.0 beta's, and goes
 * with the matching branches of `normalizeWindowTabs` once betas are gone.
 */
export type StoredWindowTabs = Partial<Omit<WindowTabs, "tabs">> & {
  activeId?: null | string;
  group?: string;
  previousGroup?: string;
  tabs?: (WindowTab & { at?: number; trail?: string[] })[];
};

/** A page tab of the window: a browser session of its own, in a group. */
export type PageTab = Extract<WindowTab, { kind: "page" }>;

/** A screen tab of the window: a route of its own, walked by a router of its own. */
export type ScreenTab = Extract<WindowTab, { kind: "screen" }>;

/** Where a screen tab's router has been, and where along it the tab stands. */
type ScreenHistory = NonNullable<ScreenTab["history"]>;

/**
 * The tabs as kept, read as this build keeps them: the tab the group on
 * screen had up becomes that group's, a screen's trail becomes its history,
 * and a screen no group's tab may stand on is dropped with its history.
 */
export function normalizeWindowTabs(stored: StoredWindowTabs): WindowTabs {
  const activeByGroup = { ...stored.activeByGroup };
  if (stored.group !== undefined && stored.activeId) {
    activeByGroup[stored.group] = stored.activeId;
  }
  const tabs = (stored.tabs ?? []).map((tab): WindowTab => {
    if (
      tab.kind !== "screen" ||
      (tab.trail === undefined && tab.at === undefined)
    ) {
      return tab;
    }
    const { at, trail, ...rest } = tab;
    const entries = trail ?? [tab.href];
    return {
      ...rest,
      history: {
        entries,
        index: Math.min(
          Math.max(at ?? entries.length - 1, 0),
          entries.length - 1,
        ),
      },
    };
  });
  return { activeByGroup, tabs: groupScreenTabsOnly(tabs) };
}

/** A group's tabs, in strip order. */
export function tabsIn(state: WindowTabs, group: string | undefined) {
  return group === undefined
    ? []
    : state.tabs.filter((tab) => tab.group === group);
}

/** The tab a group has up: the one it last had, or its first. */
export function upIn(
  state: WindowTabs,
  group: string | undefined,
): undefined | WindowTab {
  if (group === undefined) {
    return undefined;
  }
  const own = tabsIn(state, group);
  return own.find((tab) => tab.id === state.activeByGroup[group]) ?? own[0];
}

/**
 * Whether a tab is still its group's own new tab, standing where it opened:
 * the page that reaches everything, or the web's start beside a chat. Such a
 * tab is told where to go rather than kept beside what was asked for; one
 * that has walked somewhere is a tab of its own.
 */
export function isFreshTab(tab: WindowTab): boolean {
  return tab.kind === "screen" && sameHref(tab.href, newTabHrefOf(tab.group));
}

/** Whether a tab is the new-tab page: what a draft gathers from, and nothing gathered itself. */
export function isHomeTab(tab: WindowTab): boolean {
  return (
    tab.kind === "screen" &&
    parseHref(tab.href).pathname === parseHref(NEW_TAB_HREF).pathname
  );
}

/** One tab of its group up; a tab in no group has nothing to be up in. */
export function selectTab(state: WindowTabs, id: string): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || tab.group === undefined) {
    return state;
  }
  return pointAt(state, tab.group, id);
}

/** A screen tab at an address, at the end of a group's tabs, and up in it when asked. */
export function addScreen(
  state: WindowTabs,
  {
    group,
    href,
    id,
    isOpened = false,
    select,
  }: {
    group: string;
    href: string;
    id: string;
    isOpened?: boolean;
    select: boolean;
  },
): WindowTabs {
  const tab: WindowTab = { group, href, id, isOpened, kind: "screen" };
  const added = { ...state, tabs: [...state.tabs, tab] };
  return select ? pointAt(added, group, id) : added;
}

/**
 * The screen tab already at an address in a group, or one opened there. A
 * file's tab may have become the page that shows the file; it is still the
 * file's tab, and the file is not opened twice. A group waiting behind with
 * its new tab up is told where to go, the way the tab on screen is: the
 * screen lands in that tab rather than beside it, and the tab keeps its id,
 * so what remembered it still finds it.
 */
export function openOrFocusScreen(
  state: WindowTabs,
  {
    group,
    href,
    id,
    isOpened = false,
    isWaiting,
    select,
  }: {
    group: string;
    href: string;
    /** The id a new tab takes. */
    id: string;
    isOpened?: boolean;
    /** Whether the group is waiting behind rather than on screen. */
    isWaiting: boolean;
    select: boolean;
  },
): { id: string; state: WindowTabs } {
  const filePath = parseHref(href).search.get("file") ?? undefined;
  const existing = state.tabs.find(
    (tab) =>
      tab.group === group &&
      (tab.kind === "screen"
        ? sameHref(tab.href, href)
        : filePath !== undefined && hostPathOfFileUrl(tab.url) === filePath),
  );
  if (existing) {
    return {
      id: existing.id,
      state: select ? selectTab(state, existing.id) : state,
    };
  }
  const up = isWaiting ? upIn(state, group) : undefined;
  if (up && isHomeTab(up)) {
    const told = mapTab(state, up.id, (tab) => {
      if (tab.kind !== "screen") {
        return tab;
      }
      const { history: _left, ...rest } = tab;
      return { ...rest, future: [], href, isOpened };
    });
    return { id: up.id, state: select ? selectTab(told, up.id) : told };
  }
  return { id, state: addScreen(state, { group, href, id, isOpened, select }) };
}

/**
 * Where a screen tab is now, by the tab: the screen inside it moved. The
 * address joins its history and drops what was ahead of it, the way a
 * browser drops the forward stack when you go somewhere new. The address it
 * already stands on moves nothing.
 */
export function visitScreen(
  state: WindowTabs,
  id: string,
  href: string,
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (tab?.kind !== "screen" || sameHref(tab.href, href)) {
    return state;
  }
  const { entries, index } = historyOf(tab);
  return screenMoved(state, id, {
    history: {
      entries: [...entries.slice(0, index + 1), href],
      index: index + 1,
    },
    href,
  });
}

/**
 * A screen tab's router moved, and the tab follows: where it stands and the
 * history behind and ahead of it. Nothing changes when nothing differs.
 */
export function screenMoved(
  state: WindowTabs,
  id: string,
  { history, href }: { history: ScreenHistory; href: string },
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (tab?.kind !== "screen") {
    return state;
  }
  const was = historyOf(tab);
  if (
    tab.href === href &&
    was.index === history.index &&
    was.entries.length === history.entries.length &&
    was.entries.every((entry, at) => entry === history.entries[at])
  ) {
    return state;
  }
  return mapTab(state, id, (entry) => ({ ...entry, history, href }));
}

/**
 * A group's tab up goes to a screen: a screen tab walks there, and a page
 * becomes the screen, with the page a step back.
 */
export function navigateScreen(
  state: WindowTabs,
  { group, href, id }: { group: string; href: string; id: string },
): WindowTabs {
  const up = upIn(state, group);
  if (up?.kind === "page") {
    return replaceTab(
      state,
      up.id,
      visitInTab(up, { href, id, kind: "screen" }),
    );
  }
  return up ? visitScreen(state, up.id, href) : state;
}

/** A different tab in one's place, keeping where it sits in the strip, whose group it is in, and whether it was up. */
export function replaceTab(
  state: WindowTabs,
  id: string,
  next: WindowTab,
): WindowTabs {
  const replaced = state.tabs.find((tab) => tab.id === id);
  if (!replaced) {
    return state;
  }
  const tab = { ...next, group: next.group ?? replaced.group };
  const group = tab.group;
  return {
    activeByGroup:
      group !== undefined && state.activeByGroup[group] === id
        ? { ...state.activeByGroup, [group]: tab.id }
        : state.activeByGroup,
    tabs: state.tabs.map((entry) => (entry.id === id ? tab : entry)),
  };
}

/** A step between what a tab has shown (a page, a screen) rather than inside one. */
export function stepVisit(
  state: WindowTabs,
  id: string,
  direction: -1 | 1,
): { next: undefined | WindowTab; state: WindowTabs } {
  const tab = state.tabs.find((entry) => entry.id === id);
  const next = tab && stepTabVisit(tab, direction);
  return next
    ? { next, state: replaceTab(state, id, next) }
    : { next: undefined, state };
}

/** A step along a screen tab's own history: the address it now stands on, or nothing when it has none left that way. */
export function stepTrail(
  state: WindowTabs,
  id: string,
  direction: -1 | 1,
): { href: string | undefined; state: WindowTabs } {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (tab?.kind !== "screen") {
    return { href: undefined, state };
  }
  const { entries } = historyOf(tab);
  const index = historyOf(tab).index + direction;
  const href = entries[index];
  if (href === undefined) {
    return { href: undefined, state };
  }
  return {
    href,
    state: screenMoved(state, id, { history: { entries, index }, href }),
  };
}

/**
 * A tab closed. The tab up in its group gives way to the one before it, or
 * the first left. A draft's last tab is replaced by its new tab, since the
 * draft is what is gathered beside the words and the page is where gathering
 * starts; a chat's last tab closes like any other.
 */
export function closeTab(
  state: WindowTabs,
  id: string,
  { homeId }: { homeId: string },
): WindowTabs {
  const index = state.tabs.findIndex((tab) => tab.id === id);
  const closing = state.tabs[index];
  if (!closing) {
    return state;
  }
  const { group } = closing;
  const remaining = state.tabs.filter((tab) => tab.id !== id);
  const wasUp = upIn(state, group)?.id === id;
  if (group === undefined) {
    return { ...state, tabs: remaining };
  }
  if (
    draftOfGroup(group) !== undefined &&
    !remaining.some((tab) => tab.group === group)
  ) {
    const href = newTabHrefOf(group);
    const home: WindowTab = { group, href, id: homeId, kind: "screen" };
    const tabs = [
      ...remaining.slice(0, index),
      home,
      ...remaining.slice(index),
    ];
    return wasUp
      ? pointAt({ ...state, tabs }, group, homeId)
      : { ...state, tabs };
  }
  if (!wasUp) {
    return { ...state, tabs: remaining };
  }
  const next =
    state.tabs.slice(0, index).findLast((tab) => tab.group === group) ??
    remaining.find((tab) => tab.group === group);
  const { [group]: _closed, ...activeByGroup } = state.activeByGroup;
  return {
    activeByGroup: next
      ? { ...activeByGroup, [group]: next.id }
      : activeByGroup,
    tabs: remaining,
  };
}

/**
 * A group handed over to a chat: what a draft gathered becomes the chat's
 * tabs exactly as they are, guests and all, the one up still up. A tab
 * already filed under the chat (a task's browser that arrived before the
 * start came back) stays where it is, beside them.
 */
export function adoptGroup(
  state: WindowTabs,
  from: string,
  to: string,
): WindowTabs {
  const moved = state.tabs
    .filter((tab) => tab.group === from)
    .map((tab) => ({ ...tab, group: to }));
  const rest = state.tabs.filter((tab) => tab.group !== from);
  const { [from]: left, ...activeByGroup } = state.activeByGroup;
  const up = left ?? activeByGroup[to] ?? moved[0]?.id;
  return {
    activeByGroup:
      up === undefined ? activeByGroup : { ...activeByGroup, [to]: up },
    tabs: [...rest, ...moved],
  };
}

/** A group gone with everything in it: a draft thrown away, a chat deleted, a site closed. */
export function dropGroup(state: WindowTabs, group: string): WindowTabs {
  if (
    !(group in state.activeByGroup) &&
    !state.tabs.some((tab) => tab.group === group)
  ) {
    return state;
  }
  const { [group]: _dropped, ...activeByGroup } = state.activeByGroup;
  return {
    activeByGroup,
    tabs: state.tabs.filter((tab) => tab.group !== group),
  };
}

/** A tab into another group, standing there alone: a page drawn inside a tab becoming a site of the window's own. */
export function moveToGroup(
  state: WindowTabs,
  id: string,
  group: string,
): WindowTabs {
  return mapTab(state, id, (tab) => ({ ...tab, group }));
}

/** A group's tabs in a new order, by their strip keys; nothing moves unless every one is named. */
export function reorderGroup(
  state: WindowTabs,
  group: string,
  keys: string[],
): WindowTabs {
  const own = tabsIn(state, group);
  const ordered = keys.flatMap((key) => {
    const tab = own.find((entry) => (entry.stripKey ?? entry.id) === key);
    return tab ? [tab] : [];
  });
  if (ordered.length !== own.length) {
    return state;
  }
  let next = 0;
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.group === group ? (ordered[next++] ?? tab) : tab,
    ),
  };
}

/**
 * A page drawn inside another tab (a file tab's page beside its tree) taking
 * that tab over: the page, guest and all, stands where the tab stood, in its
 * place in the strip and its group, and back from it returns to what the tab
 * showed. The page's own entry, in the group of pages drawn inside tabs, goes.
 */
export function pageTakesOver(
  state: WindowTabs,
  { page: pageId, tab: tabId, url }: { page: string; tab: string; url: string },
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === tabId);
  const page = state.tabs.find((entry) => entry.id === pageId);
  if (!tab || page?.kind !== "page") {
    return state;
  }
  const {
    future: _future,
    group: _group,
    isOpened: _opened,
    past: _past,
    stripKey: _key,
    ...visit
  } = page;
  // At the address the page went on to, which the page's own record may not
  // have caught up with yet.
  const without = {
    ...state,
    tabs: state.tabs.filter((entry) => entry.id !== pageId),
  };
  return replaceTab(without, tabId, visitInTab(tab, { ...visit, url }));
}

/**
 * A new page tab. In a tab's place, it takes that tab's place in the strip
 * and under its strip key, so the strip sees one tab changing rather than one
 * leaving and another arriving, and it is what that group has up. Otherwise
 * it joins the group at the end with a new tab behind it, up when asked.
 */
export function openPage(
  state: WindowTabs,
  {
    group,
    homeId,
    page,
    replacing,
    select,
  }: {
    group: string | undefined;
    /** The id of the new tab a page opened on its own has behind it. */
    homeId: string;
    page: BrowserTab;
    replacing?: WindowTab;
    select: boolean;
  },
): WindowTabs {
  if (replacing) {
    const tab = visitInTab(replacing, { ...page, kind: "page" });
    const index = state.tabs.findIndex((entry) => entry.id === replacing.id);
    const tabs =
      index === -1
        ? [...state.tabs, tab]
        : state.tabs.map((entry, at) => (at === index ? tab : entry));
    return replacing.group === undefined
      ? { ...state, tabs }
      : pointAt({ ...state, tabs }, replacing.group, page.id);
  }
  const tab: WindowTab = {
    ...page,
    group,
    kind: "page",
    past: [{ href: newTabHrefOf(group), id: homeId, kind: "screen" }],
  };
  const added = { ...state, tabs: [...state.tabs, tab] };
  return select && group !== undefined ? pointAt(added, group, page.id) : added;
}

/** Page tabs a group gains behind whatever it has up: a task's guests arriving, a page opened for an agent's work. */
export function addPages(
  state: WindowTabs,
  pages: (BrowserTab & { group: string | undefined })[],
): WindowTabs {
  return pages.length === 0
    ? state
    : {
        ...state,
        tabs: [
          ...state.tabs,
          ...pages.map((page) => ({ ...page, kind: "page" as const })),
        ],
      };
}

/** What a page tab knows of its page, as the page announces it; nothing changes when nothing differs. */
export function patchPage(
  state: WindowTabs,
  id: string,
  changes: Partial<Pick<BrowserTab, "favicon" | "title" | "url">>,
): WindowTabs {
  const tab = state.tabs.find(
    (entry): entry is PageTab => entry.kind === "page" && entry.id === id,
  );
  const differs =
    tab !== undefined &&
    (("favicon" in changes && changes.favicon !== tab.favicon) ||
      ("title" in changes && changes.title !== tab.title) ||
      ("url" in changes && changes.url !== tab.url));
  return differs
    ? mapTab(state, id, (entry) => ({ ...entry, ...changes }))
    : state;
}

/**
 * A tab gone somewhere new inside itself, by its own hand or the user's:
 * what was ahead of it is dropped, the way a browser drops its forward
 * stack. Given an address, a page tab is at that one.
 */
export function pageNavigated(
  state: WindowTabs,
  id: string,
  url?: string,
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || (url === undefined && !tab.future?.length)) {
    return state;
  }
  return mapTab(state, id, (entry) => ({
    ...entry,
    future: [],
    ...(url !== undefined && entry.kind === "page" ? { url } : {}),
  }));
}

/**
 * A site's tabs put back after its window tab was reopened: they take the
 * group's place, the first of them up.
 */
export function restoreGroup(
  state: WindowTabs,
  group: string,
  tabs: WindowTab[],
): WindowTabs {
  const restored = {
    ...state,
    tabs: [...state.tabs.filter((tab) => tab.group !== group), ...tabs],
  };
  const first = tabs[0];
  return first ? pointAt(restored, group, first.id) : restored;
}

/** Every tab id the window holds, past and future visits included, so nothing is opened twice. */
export function everyTabId(state: WindowTabs): Set<string> {
  return new Set(
    state.tabs.flatMap((tab) => [
      tab.id,
      ...(tab.past ?? []).map((visit) => visit.id),
      ...(tab.future ?? []).map((visit) => visit.id),
    ]),
  );
}

function mapTab(
  state: WindowTabs,
  id: string,
  update: (tab: WindowTab) => WindowTab,
): WindowTabs {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.id === id ? update(tab) : tab)),
  };
}

function pointAt(state: WindowTabs, group: string, id: string): WindowTabs {
  return state.activeByGroup[group] === id
    ? state
    : { ...state, activeByGroup: { ...state.activeByGroup, [group]: id } };
}
