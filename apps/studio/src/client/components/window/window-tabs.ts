import { type BrowserTab, type WindowTab } from "@/client/atoms/window";
import { atom, useAtomValue, useSetAtom } from "jotai";

import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { keptAtom } from "@/client/lib/kept-state";

import { appTabsAtom, groupOfHref } from "./app-tabs";
import {
  addPages,
  addScreen,
  adoptGroup,
  closeTab,
  dropGroup,
  everyTabId,
  moveToGroup,
  navigateScreen,
  normalizeWindowTabs,
  openOrFocusScreen,
  openPage,
  pageNavigated,
  pageTakesOver,
  patchPage,
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
  visitScreen,
  type WindowTabs,
} from "./tab-model";
import { sameHref } from "./window-href";

/**
 * The window's tabs, one list across every group, kept across launches on
 * this computer. Written only here, through the functions of `tab-model.ts`.
 */
const storedTabsAtom = keptAtom<WindowTabs>(
  "layout",
  "window-tabs.v9",
  { activeByGroup: {}, tabs: [] },
  // Read as this build keeps them, whatever an earlier one wrote.
  (value, initial) =>
    isStoredWindowTabs(value) ? normalizeWindowTabs(value) : initial,
);

/** Whether a kept value is the tabs at all: an object whose tabs, if any, are a list. */
function isStoredWindowTabs(value: unknown): value is StoredWindowTabs {
  return (
    value !== null &&
    typeof value === "object" &&
    (!("tabs" in value) || Array.isArray(value.tabs))
  );
}

/** The window's tabs, to read; every change goes through `useWindowTabs`. */
export const windowTabsAtom = atom((get) => get(storedTabsAtom));

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
  return `screen-${crypto.randomUUID()}`;
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

  return {
    /** The tab the group on screen has up. */
    active: selectedTabIn(state, groupOnScreen),
    /** Hands a draft's tabs to the chat it started, the one up still up. */
    adoptGroup: (from: string, to: string) => {
      apply((current) => adoptGroup(current, from, to));
    },
    /** Every tab of every group, for whoever holds something per tab rather than per strip. */
    allTabs: state.tabs,
    activeByGroup: state.activeByGroup,
    /** Page tabs a group gains behind whatever it has up. */
    addPages: (pages: (BrowserTab & { group: string | undefined })[]) => {
      apply((current) => addPages(current, pages));
    },
    close: (id: string) => {
      apply((current) => closeTab(current, id, { homeId: newScreenId() }));
    },
    dropGroup: (group: string) => {
      apply((current) => dropGroup(current, group));
    },
    /** The group on screen, by the chat's id or the site's key, or nothing while none is. */
    groupOnScreen,
    moveToGroup: (id: string, group: string) => {
      apply((current) => moveToGroup(current, id, group));
    },
    /** The tab the group on screen has up goes to a screen, in place. */
    navigateScreen: (href: string) => {
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
      href: string,
      {
        group,
        isOpened = false,
        select = false,
      }: { group?: string; isOpened?: boolean; select?: boolean } = {},
    ): string | undefined =>
      answer<string | undefined>((current, onScreen) => {
        const key = group ?? onScreen;
        if (key === undefined) {
          return { state: current, value: undefined };
        }
        const opened = openOrFocusScreen(current, {
          group: key,
          href,
          id: newScreenId(),
          isOpened,
          isWaiting: key !== onScreen,
          select: select || key === onScreen,
        });
        return { state: opened.state, value: opened.id };
      }, undefined),
    /**
     * Opens a screen at an address in a group (the group on screen, unless
     * one is named): up at once when that group is on screen or when asked,
     * and otherwise behind whatever it has up.
     */
    openScreen: (
      href: string,
      {
        group,
        isOpened = false,
        select = false,
      }: { group?: string; isOpened?: boolean; select?: boolean } = {},
    ): string | undefined =>
      answer<string | undefined>((current, onScreen) => {
        const key = group ?? onScreen;
        if (key === undefined) {
          return { state: current, value: undefined };
        }
        const id = newScreenId();
        return {
          state: addScreen(current, {
            group: key,
            href,
            id,
            isOpened,
            select: select || key === onScreen,
          }),
          value: id,
        };
      }, undefined),
    /**
     * A new page tab, in a tab's place or at the end of a group (the group
     * on screen, unless one is named); one opened beside the rest comes up
     * when its group is on screen or when asked.
     */
    openPage: ({
      group,
      page,
      replacing,
      select = false,
    }: {
      group?: string;
      page: BrowserTab;
      replacing?: WindowTab;
      select?: boolean;
    }) => {
      apply((current, onScreen) => {
        const key = group ?? onScreen;
        return openPage(current, {
          group: key,
          homeId: newScreenId(),
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
    /** One tab up in its group: on screen when the group is, and what a host drawing the group elsewhere shows. */
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
    visitHref: (id: string, href: string) => {
      const router = getGroupTabRouter(id);
      if (!router) {
        apply((current) => visitScreen(current, id, href));
      } else if (!sameHref(router.history.location.href, href)) {
        router.history.push(href);
      }
    },
    /** A screen tab's router moved; the tab follows it. */
    screenMoved: (id: string, moved: Parameters<typeof screenMoved>[2]) => {
      apply((current) => screenMoved(current, id, moved));
    },
  };
}
