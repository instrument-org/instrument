import { type BrowserTab, type WindowTab } from "@/client/atoms/window";
import { atom, useAtomValue, useSetAtom } from "jotai";

import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import {
  keptMembersAtom,
  readKept,
  readKeptMembers,
  takeKept,
  writeKept,
} from "@/client/lib/kept-state";
import { draftOfGroup } from "@/shared/drafts";
import {
  fileOfTabGroup,
  HOSTED_PAGE_GROUP_PREFIX,
  WINDOW_TABS_KEY,
} from "@/shared/kept-state";
import { type ChatId, StoreId } from "@instrument-org/workspace/client";

import { appTabsAtom, groupOfHref } from "./app-tabs";
import {
  addPages,
  addScreen,
  besideOf,
  chatPlaceOf,
  chatsOfGroup,
  chatUpIn,
  groupLayoutOf,
  closeTab,
  dropGroup,
  everyTabId,
  focusSide,
  isChatTab,
  moveTabTo,
  moveToGroup,
  navigateScreen,
  normalizeWindowTabs,
  openInGroup,
  openOrFocusScreen,
  openPage,
  pageNavigated,
  pageTakesOver,
  patchPage,
  type Placing,
  raiseTab,
  reopenTab,
  reorderGroup,
  replaceTab,
  restoreGroup,
  screenMoved,
  selectTab,
  type StoredWindowTabs,
  stepTrail,
  stepVisit,
  tabsIn,
  selectedTabIn,
  tabShowingIn,
  tabToScreen,
  type WindowTabs,
  withoutChatsBehind,
} from "./tab-model";
import { openLinkAddress } from "./open-link-address";
import { standInTabsAtom } from "./stand-in-tabs";
import { chatHref, chatOfGroup, newChatHref, sameHref } from "./window-href";

/** The member a tab with no group is kept under. */
const NO_GROUP = "-";

// What a build with one window kept whole, once, as every window keeps it now: ahead of
// the atom below, which reads what is kept as it is made.
const earlierTabs = takeKept("layout", "window-tabs.v9");
if (isStoredWindowTabs(earlierTabs)) {
  for (const [member, group] of splitTabGroups(
    normalizeWindowTabs(earlierTabs),
  )) {
    writeKept(fileOfTabGroup(member), `${WINDOW_TABS_KEY}/${member}`, group);
  }
}
carryEarlierGroups();

/**
 * The groups a build that drew a group's chat beside its tabs kept, as
 * groups whose chat is a tab like any other: once, ahead of the atom below,
 * and leaving what that build kept for it to read. A group with its chat's
 * card open gets the chat's tab on a side of its own, the right, with the
 * keyboard; one whose card was closed gets it last on its one side. A
 * draft's group gets the draft's new chat the same way.
 */
function carryEarlierGroups() {
  if (readKeptMembers("layout", WINDOW_TABS_KEY).size > 0) {
    return;
  }
  const closed = readKept("view", "tab-groups-chat-closed.v2");
  const isClosed = (group: string) =>
    closed !== null &&
    typeof closed === "object" &&
    group in closed &&
    (closed as Record<string, unknown>)[group] === true; // Checked a key at a time.
  for (const [group, member] of readKeptMembers("layout", "window-tabs.v10")) {
    if (!isTabGroupMember(member)) {
      continue;
    }
    const carried = carriedMember(group, member, isClosed(group));
    writeKept("layout", `${WINDOW_TABS_KEY}/${group}`, carried);
  }
}

/** One group as `carryEarlierGroups` keeps it again. */
function carriedMember(
  group: string,
  member: TabGroupMember,
  isClosed: boolean,
): TabGroupMember {
  const chat = chatOfGroup(group);
  const draft = draftOfGroup(group);
  const href =
    chat === undefined
      ? draft === undefined
        ? undefined
        : newChatHref(draft)
      : chatHref(chat);
  if (href === undefined || member.tabs.length === 0) {
    return member;
  }
  const chatTab: WindowTab = {
    group,
    href,
    id: newScreenId(),
    kind: "screen",
    ...(isClosed ? {} : { side: 1 }),
  };
  if (isClosed) {
    return { ...member, tabs: [...member.tabs, chatTab] };
  }
  return {
    active: chatTab.id,
    ...(member.active === undefined ? {} : { beside: member.active }),
    tabs: [...member.tabs, chatTab],
  };
}

/**
 * The window's tabs, one list across every group, kept across launches on
 * this computer. Written only here, through the functions of `tab-model.ts`.
 */
const storedTabsAtom = keptMembersAtom<WindowTabs>(
  fileOfTabGroup,
  WINDOW_TABS_KEY,
  {
    join: joinTabGroups,
    split: splitTabGroups,
  },
);

interface TabGroupMember {
  active?: string;
  /** The tab up on the side without the keyboard, in a group of two sides. */
  beside?: string;
  tabs: WindowTab[];
}

function isTabGroupMember(value: unknown): value is TabGroupMember {
  return (
    value !== null &&
    typeof value === "object" &&
    "tabs" in value &&
    Array.isArray(value.tabs)
  );
}

/**
 * The tabs by group, each kept by itself: a group's tabs, which is up on
 * each side, belong to it whichever window shows it (`fileOfTabGroup`).
 */
function splitTabGroups({ activeByGroup, besideByGroup = {}, tabs }: WindowTabs) {
  const members = new Map<string, TabGroupMember>();
  const memberOf = (key: string) => {
    let member = members.get(key);
    if (!member) {
      member = { tabs: [] };
      members.set(key, member);
    }
    return member;
  };
  for (const tab of tabs) {
    memberOf(tab.group ?? NO_GROUP).tabs.push(tab);
  }
  for (const [group, active] of Object.entries(activeByGroup)) {
    memberOf(group).active = active;
  }
  for (const [group, beside] of Object.entries(besideByGroup)) {
    memberOf(group).beside = beside;
  }
  return members;
}

function joinTabGroups(members: Map<string, unknown>): WindowTabs {
  const activeByGroup: Record<string, string> = {};
  const besideByGroup: Record<string, string> = {};
  const tabs: WindowTab[] = [];
  for (const [group, member] of members) {
    if (member === null || typeof member !== "object") {
      continue;
    }
    if ("active" in member && typeof member.active === "string") {
      activeByGroup[group] = member.active;
    }
    if ("beside" in member && typeof member.beside === "string") {
      besideByGroup[group] = member.beside;
    }
    if ("tabs" in member && Array.isArray(member.tabs)) {
      tabs.push(...(member.tabs as WindowTab[])); // Written by this module alone.
    }
  }
  return { activeByGroup, besideByGroup, tabs: withoutChatsBehind(tabs) };
}

/** Whether a kept value is the tabs at all: an object whose tabs, if any, are a list. */
function isStoredWindowTabs(value: unknown): value is StoredWindowTabs {
  return (
    value !== null &&
    typeof value === "object" &&
    (!("tabs" in value) || Array.isArray(value.tabs))
  );
}

/**
 * The group of the page a file tab draws in its viewer, by the tab's id: a
 * group no strip lists, holding that one page.
 */
export function hostGroupOf(tabId: string) {
  return `${HOSTED_PAGE_GROUP_PREFIX}${tabId}`;
}

/** The window's tabs, to read; every change goes through `useWindowTabs`. */
export const windowTabsAtom = atom(
  (get) => get(standInTabsAtom) ?? get(storedTabsAtom),
);

/**
 * The group on screen: the chat's id or the site's group the window's
 * tab up stands on, or none for a screen that is its own route. Derived from
 * where that tab is, never kept beside it.
 */
export const groupOnScreenAtom = atom((get) => {
  const model = get(appTabsAtom);
  const tab = model.tabs.find((entry) => entry.id === model.selectedId);
  return tab ? groupOfHref(tab.pathname) : undefined;
});

/** Every tab id the window holds, past and future visits included, so nothing is opened twice. */
export const everyTabIdAtom = atom((get) => everyTabId(get(storedTabsAtom)));

/** One change to the tabs, given the group on screen as it is at that moment. */
const applyAtom = atom(
  null,
  (
    get,
    set,
    update: (
      state: WindowTabs,
      groupOnScreen: string | undefined,
    ) => WindowTabs,
  ) => {
    // A picture of a window changes nothing.
    if (get(standInTabsAtom) !== undefined) {
      return;
    }
    const current = get(storedTabsAtom);
    const next = update(current, get(groupOnScreenAtom));
    if (next !== current) {
      set(storedTabsAtom, next);
    }
  },
);

/**
 * Applies one change to the tabs as they are at that moment, with the group
 * on screen as it is then: for an effect or a listener that needs a setter
 * that never changes. Components otherwise use `useWindowTabs`.
 */
export function useWindowTabsChange() {
  return useSetAtom(applyAtom);
}

/** A fresh id for a screen tab. */
export function newScreenId() {
  return StoreId.newTabId();
}

/**
 * The window's tabs, in groups: every chat has a group of its own, keyed by
 * its session, every draft one under its key, and every site of the window's
 * own one under its. The group on screen is the window's tab up's; the
 * others keep what they have for when they come back, and a host drawing a
 * group somewhere else (a draft's band, a popped-out chat) draws the tab
 * that group has up. A group may hold no tabs at all: the chat or the draft
 * stands over the tabs rather than among them.
 *
 * Every change is applied to the tabs as they are at that moment, with the
 * group on screen read then too, so two changes in one tick each see the
 * other's.
 */
export function useWindowTabs() {
  const state = useAtomValue(windowTabsAtom);
  const groupOnScreen = useAtomValue(groupOnScreenAtom);
  const apply = useSetAtom(applyAtom);

  /** Applies a change that also answers something, and hands the answer back. */
  const answer = <T>(
    change: (
      current: WindowTabs,
      onScreen: string | undefined,
    ) => { state: WindowTabs; value: T },
    fallback: T,
  ): T => {
    let value = fallback;
    apply((current, onScreen) => {
      const result = change(current, onScreen);
      value = result.value;
      return result.state;
    });
    return value;
  };

  /**
   * Sends a tab to a screen, a step on in its history: a screen tab's router
   * walks, and the tab follows it as it lands; a page becomes the screen. A
   * chat's tab stays on the chat, and the screen opens right after it.
   */
  const visitHref = (id: string, href: string) => {
    const router = getGroupTabRouter(id);
    const tab = state.tabs.find((entry) => entry.id === id);
    if (!router || (tab !== undefined && isChatTab(tab))) {
      apply((current) =>
        tabToScreen(current, { href, id, newId: newScreenId() }),
      );
    } else if (!sameHref(router.history.location.href, href)) {
      router.history.push(href);
    }
  };

  return {
    /** The tab the group on screen has up. */
    active: selectedTabIn(state, groupOnScreen),
    /** Every tab of every group, for whoever holds something per tab rather than per strip. */
    allTabs: state.tabs,
    /** The tab up on the other side from a tab, in a group of two sides (`besideOf`). */
    besideOf: (id: string) => besideOf(state, id),
    /** Where something opened for a chat goes, the group on screen first (`chatPlaceOf`). */
    chatPlace: (chat: ChatId) => chatPlaceOf(state, chat, groupOnScreen),
    /** The chats a group has a tab on, its left side first (`chatsOfGroup`). */
    chatsIn: (group: string) => chatsOfGroup(state, group),
    /** The chat a group has up, the side with the keyboard first (`chatUpIn`). */
    chatUpIn: (group: string) => chatUpIn(state, group),
    activeByGroup: state.activeByGroup,
    /** Page tabs a group gains behind whatever it has up, at its end or right after a tab. */
    addPages: (
      pages: (BrowserTab & { group: string | undefined })[],
      placing: { after?: string } = {},
    ) => {
      apply((current) => addPages(current, pages, placing));
    },
    close: (id: string) => {
      apply((current) => closeTab(current, id));
    },
    dropGroup: (group: string) => {
      apply((current) => dropGroup(current, group));
    },
    /** The side with the keyboard, in a group of two sides, moved to the other. */
    focusSide: (group: string, side: 0 | 1) => {
      apply((current) => focusSide(current, group, side));
    },
    /** The group on screen, by its key, or nothing while none is. */
    groupOnScreen,
    /** A group's sides as they are laid out now (`groupLayoutOf`). */
    layoutOf: (group: string) => groupLayoutOf(state, group),
    /**
     * A tab moved to a side of a group, at a place among that side's tabs:
     * within its strip, to the other side, or to another group
     * (`moveTabTo`).
     */
    moveTo: (move: Parameters<typeof moveTabTo>[1]) => {
      apply((current) => moveTabTo(current, move));
    },
    moveToGroup: (id: string, group: string) => {
      apply((current) => moveToGroup(current, id, group));
    },
    /**
     * A tab opened in a group as every open places one: on a side, right
     * after a tab, up with the keyboard when asked (`openInGroup`).
     */
    openIn: (tab: WindowTab, placing: Placing & { select?: boolean }) => {
      apply((current) => openInGroup(current, tab, placing));
    },
    /**
     * The tab the group on screen has up goes to a screen, in place. Here
     * and in the opens below, a link address opens where it lives instead
     * (`openLinkAddress`).
     */
    navigateScreen: (to: string) => {
      const href = openLinkAddress(to);
      if (href === undefined) {
        return;
      }
      // A screen tab walks there by its router, as `visitHref` sends it.
      const up = selectedTabIn(state, groupOnScreen);
      if (up?.kind === "screen" && getGroupTabRouter(up.id)) {
        visitHref(up.id, href);
        return;
      }
      apply((current, onScreen) =>
        onScreen === undefined
          ? current
          : navigateScreen(current, {
              group: onScreen,
              href,
              id: newScreenId(),
            }),
      );
    },
    /**
     * Shows the screen tab already at that address in a group (the group on
     * screen, unless one is named), or opens one there. It comes up in its
     * group when the group is on screen or when asked.
     */
    openOrFocusScreen: (
      to: string,
      {
        after,
        group,
        isOpened = false,
        select = false,
      }: {
        /** The tab a new one opens right after, on that tab's side. */
        after?: string;
        group?: string;
        isOpened?: boolean;
        select?: boolean;
      } = {},
    ): string | undefined => {
      const href = openLinkAddress(to);
      if (href === undefined) {
        return undefined;
      }
      return answer<string | undefined>((current, onScreen) => {
        const key = group ?? onScreen;
        if (key === undefined) {
          return { state: current, value: undefined };
        }
        const opened = openOrFocusScreen(current, {
          ...(after === undefined ? {} : { after }),
          group: key,
          href,
          id: newScreenId(),
          isOpened,
          isWaiting: key !== onScreen,
          select: select || key === onScreen,
        });
        return { state: opened.state, value: opened.id };
      }, undefined);
    },
    /**
     * Brings up the tab of the group on screen already showing what an
     * address shows (`tabShowingIn`); false where none does.
     */
    selectShowing: (href: string): boolean =>
      answer<boolean>((current, onScreen) => {
        const tab =
          onScreen === undefined
            ? undefined
            : tabShowingIn(current, onScreen, href);
        return tab
          ? { state: selectTab(current, tab.id), value: true }
          : { state: current, value: false };
      }, false),
    /**
     * Opens a screen at an address in a group (the group on screen, unless
     * one is named): up at once when that group is on screen or when asked,
     * and otherwise behind whatever it has up.
     */
    openScreen: (
      to: string,
      {
        after,
        group,
        id: given,
        isOpened = false,
        select = false,
        side,
      }: {
        /** The tab it opens right after, on that tab's side. */
        after?: string;
        group?: string;
        /** The tab's id, for one the strip already draws by it: a file held over it. */
        id?: string;
        isOpened?: boolean;
        select?: boolean;
        side?: Placing["side"];
      } = {},
    ): string | undefined => {
      const href = openLinkAddress(to);
      if (href === undefined) {
        return undefined;
      }
      return answer<string | undefined>((current, onScreen) => {
        const key = group ?? onScreen;
        if (key === undefined) {
          return { state: current, value: undefined };
        }
        const id = given ?? newScreenId();
        return {
          state: addScreen(current, {
            ...(after === undefined ? {} : { after }),
            group: key,
            href,
            id,
            isOpened,
            select: select || key === onScreen,
            ...(side === undefined ? {} : { side }),
          }),
          value: id,
        };
      }, undefined);
    },
    /**
     * A screen of its own right after the tab the group on screen has up,
     * as a link opened in a new tab lands: up at once, or waiting behind
     * when asked.
     */
    openBeside: (
      to: string,
      { behind = false }: { behind?: boolean } = {},
    ): string | undefined => {
      const href = openLinkAddress(to);
      if (href === undefined) {
        return undefined;
      }
      return answer<string | undefined>((current, onScreen) => {
        if (onScreen === undefined) {
          return { state: current, value: undefined };
        }
        const id = newScreenId();
        return {
          state: addScreen(current, {
            after: selectedTabIn(current, onScreen)?.id,
            group: onScreen,
            href,
            id,
            isOpened: true,
            select: !behind,
          }),
          value: id,
        };
      }, undefined);
    },
    /**
     * A new page tab, in a tab's place or at the end of a group (the group
     * on screen, unless one is named); one opened beside the rest comes up
     * when its group is on screen or when asked.
     */
    openPage: ({
      after,
      group,
      page,
      replacing,
      select = false,
      side,
    }: {
      after?: string;
      group?: string;
      page: BrowserTab;
      replacing?: WindowTab;
      select?: boolean;
      side?: Placing["side"];
    }) => {
      apply((current, onScreen) => {
        const key = group ?? onScreen;
        return openPage(current, {
          ...(after === undefined ? {} : { after }),
          ...(side === undefined ? {} : { side }),
          group: key,
          page,
          ...(replacing ? { replacing } : {}),
          select: select || group === undefined || key === onScreen,
        });
      });
    },
    pageNavigated: (id: string, url?: string) => {
      apply((current) => pageNavigated(current, id, url));
    },
    /** A page drawn inside a tab takes that tab over; see `pageTakesOver`. */
    pageTakesOver: (page: string, tab: string, url: string) => {
      apply((current) => pageTakesOver(current, { page, tab, url }));
    },
    patchPage: (id: string, changes: Parameters<typeof patchPage>[2]) => {
      apply((current) => patchPage(current, id, changes));
    },
    /** A group's tabs in a new order, by their strip keys. */
    reorder: (keys: string[], group: string) => {
      apply((current) => reorderGroup(current, group, keys));
    },
    replace: (id: string, next: WindowTab) => {
      apply((current) => replaceTab(current, id, next));
    },
    restoreGroup: (group: string, tabs: WindowTab[]) => {
      apply((current) => restoreGroup(current, group, tabs));
    },
    /** A closed tab back where it stood in its group, up in it. */
    reopen: (tab: WindowTab, index: number) => {
      apply((current) => reopenTab(current, { index, tab }));
    },
    /** One tab up on its side, the keyboard staying where it is (`raiseTab`). */
    raise: (id: string) => {
      apply((current) => raiseTab(current, id));
    },
    /** One tab up in its group, with the keyboard: on screen when the group is. */
    select: (id: string) => {
      apply((current) => selectTab(current, id));
    },
    /**
     * A step along a screen tab's own trail: the address it steps to, which
     * the tab now stands on, or nothing when it has none left.
     */
    stepTab: (id: string, direction: -1 | 1): string | undefined => {
      const router = getGroupTabRouter(id);
      if (!router) {
        return answer<string | undefined>((current) => {
          const stepped = stepTrail(current, id, direction);
          return { state: stepped.state, value: stepped.href };
        }, undefined);
      }
      // The router walks, and the tab follows it as it lands.
      const index = router.history.location.state.__TSR_index + direction;
      if (index < 0 || index >= router.history.length) {
        return undefined;
      }
      router.history.go(direction);
      return router.history.location.href;
    },
    /**
     * A step between what a tab has shown (a page, a screen) rather than
     * inside one, for the tab named, whether or not it is on screen.
     */
    stepVisitOf: (id: string, direction: -1 | 1): undefined | WindowTab =>
      answer<undefined | WindowTab>((current) => {
        const stepped = stepVisit(current, id, direction);
        return { state: stepped.state, value: stepped.next };
      }, undefined),
    /** The tab a group has up, or would come on screen at. */
    selectedTabIn: (group: string | undefined) => selectedTabIn(state, group),
    /** The tabs of the group on screen, in strip order. */
    tabs: tabsIn(state, groupOnScreen),
    /** Sends a screen tab to another address, a step on in its history. */
    visitHref,
    /** A screen tab's router moved; the tab follows it. */
    screenMoved: (id: string, moved: Parameters<typeof screenMoved>[2]) => {
      apply((current) => screenMoved(current, id, moved));
    },
  };
}
