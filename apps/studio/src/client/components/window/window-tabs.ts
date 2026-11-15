import { type BrowserTab, type WindowTab } from "@/client/atoms/window";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";

import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { keptMembersAtom } from "@/client/lib/kept-state";
import {
  fileOfTabGroup,
  HOSTED_PAGE_GROUP_PREFIX,
  NO_GROUP_MEMBER,
  WINDOW_TABS_KEY,
} from "@/shared/kept-state";
import { workingTabOf } from "@/shared/working-tab";
import { type ChatId, StoreId } from "@instrument-org/workspace/client";

import { appTabsAtom, groupOfHref } from "./app-tabs";
import {
  type BesideAsk,
  openBesideChat,
  previousOpenedIn,
} from "./beside-chat";
import {
  addPages,
  addScreen,
  besideOf,
  chatUpIn,
  groupLayoutOf,
  closeSide,
  closeTab,
  dropGroup,
  everyTabId,
  focusSide,
  joinSides,
  type GroupOwn,
  markOpenedBy,
  markPrompted,
  moveTabTo,
  moveToGroup,
  navigateScreen,
  openInGroup,
  openOrFocusScreen,
  openPage,
  pageNavigated,
  pageTakesOver,
  patchPage,
  type Placing,
  raiseTab,
  reopenSide,
  reopenTab,
  reorderGroup,
  replaceTab,
  restoreGroup,
  screenMoved,
  selectTab,
  stepTrail,
  stepVisit,
  tabsIn,
  selectedTabIn,
  tabShowingIn,
  tabToScreen,
  type WindowTabs,
  withGroupOwn,
} from "./tab-model";
import { useIsGroupOpen } from "./open-groups";
import { openLinkAddress } from "./open-link-address";
import { standInTabsAtom } from "./stand-in-tabs";
import { sameHref } from "./window-href";

/** A kept group's shape; its tabs' own fields are this module's to write and read. */
const TabGroupMemberSchema = z.object({
  focused: z.union([z.literal(0), z.literal(1)]),
  pinned: z.boolean().optional(),
  share: z.number().optional(),
  sides: z
    .array(
      z.object({
        tabs: z.array(z.looseObject({ id: z.string(), kind: z.string() })),
        up: z.string().optional(),
      }),
    )
    .min(1)
    .max(2),
});

/**
 * Every group's tabs on this computer, one list across them, kept across
 * launches. Each group is one member of the kept file, under its own id, in
 * the shape the agent reads a group in: its sides, each its tabs in strip
 * order and the one up, which side has the keyboard, and its own pin and
 * share. A tab keeps neither its group nor its side, which the member says.
 * Written only here, through the functions of `tab-model.ts`.
 */
const storedTabsAtom = keptMembersAtom<WindowTabs>(
  fileOfTabGroup,
  WINDOW_TABS_KEY,
  {
    join: joinTabGroups,
    split: splitTabGroups,
  },
);

/** A tab as a member keeps it, without its group or side. */
type KeptTab = Omit<WindowTab, "group" | "side">;

/** A group as it is kept (`WINDOW_TABS_KEY`). */
interface TabGroupMember extends GroupOwn {
  focused: 0 | 1;
  sides: { tabs: KeptTab[]; up?: string }[];
}

function keptTab({ group: _group, side: _side, ...tab }: WindowTab): KeptTab {
  return tab;
}

/**
 * The tabs by group, each kept by itself as its layout reads
 * (`groupLayoutOf`): a group's tabs belong to it whichever window shows it
 * (`fileOfTabGroup`).
 */
function splitTabGroups(state: WindowTabs) {
  const members = new Map<string, TabGroupMember>();
  const ungrouped = state.tabs.filter((tab) => tab.group === undefined);
  if (ungrouped.length > 0) {
    members.set(NO_GROUP_MEMBER, {
      focused: 0,
      sides: [{ tabs: ungrouped.map(keptTab) }],
    });
  }
  const groups = new Set([
    ...state.tabs.flatMap((tab) =>
      tab.group === undefined ? [] : [tab.group],
    ),
    ...Object.keys(state.groups ?? {}),
  ]);
  for (const group of groups) {
    const { focused, sides } = groupLayoutOf(state, group);
    members.set(group, {
      ...state.groups?.[group],
      focused,
      sides: sides.map(({ tabs, up }) => ({
        tabs: tabs.map(keptTab),
        ...(up === undefined ? {} : { up }),
      })),
    });
  }
  return members;
}

function joinTabGroups(members: Map<string, unknown>): WindowTabs {
  const activeByGroup: Record<string, string> = {};
  const besideByGroup: Record<string, string> = {};
  const groups: Record<string, GroupOwn> = {};
  const tabs: WindowTab[] = [];
  for (const [key, value] of members) {
    const member = TabGroupMemberSchema.safeParse(value).data;
    if (member === undefined) {
      continue;
    }
    const group = key === NO_GROUP_MEMBER ? undefined : key;
    member.sides.forEach((side, at) => {
      for (const tab of side.tabs) {
        // Written by this module alone.
        tabs.push({
          ...(tab as KeptTab),
          ...(group === undefined ? {} : { group }),
          ...(at === 1 ? { side: 1 } : {}),
        } as WindowTab);
      }
    });
    if (group === undefined) {
      continue;
    }
    const focused = member.sides[member.focused] ?? member.sides[0];
    const other = member.sides.find((side) => side !== focused);
    if (focused?.up !== undefined) {
      activeByGroup[group] = focused.up;
    }
    if (other?.up !== undefined) {
      besideByGroup[group] = other.up;
    }
    const own: GroupOwn = {
      ...(member.pinned === true ? { pinned: true } : {}),
      ...(member.share === undefined ? {} : { share: member.share }),
    };
    if (Object.keys(own).length > 0) {
      groups[group] = own;
    }
  }
  return { activeByGroup, besideByGroup, groups, tabs };
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
 * The group on screen: the group the window's tab up stands on, or none for
 * a screen that is its own route. Derived from where that tab is, never kept
 * beside it.
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

/** No group's own record, one object for every render. */
const NO_GROUP_MEMBER_OWN: Record<string, GroupOwn> = {};

/** A fresh id for a screen tab. */
export function newScreenId() {
  return StoreId.newTabId();
}

/**
 * The window's tabs, in groups (`WindowTabs`). The group on screen is the
 * window's tab up's; the others keep what they have for when they come back,
 * and a host drawing a group somewhere else (a draft's band) draws the tab
 * that group has up.
 *
 * Every change is applied to the tabs as they are at that moment, with the
 * group on screen read then too, so two changes in one tick each see the
 * other's.
 */
export function useWindowTabs() {
  const state = useAtomValue(windowTabsAtom);
  const groupOnScreen = useAtomValue(groupOnScreenAtom);
  const apply = useSetAtom(applyAtom);
  const isOpen = useIsGroupOpen();

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
   * walks, and the tab follows it as it lands, a chat's included; a page
   * becomes the screen.
   */
  const visitHref = (id: string, href: string) => {
    const router = getGroupTabRouter(id);
    if (!router) {
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
    /** The tab a chat's agent works from, where what it opens goes (`workingTabOf`). */
    chatTab: (chat: ChatId) => workingTabOf(state.tabs, chat, isOpen),
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
    /** One side of a group of two closed whole (`closeSide`). */
    closeSide: (group: string, side: 0 | 1) => {
      apply((current) => closeSide(current, group, side));
    },
    /** A closed side back as the side it was, up with the keyboard (`reopenSide`). */
    reopenSide: (placing: Parameters<typeof reopenSide>[1]) => {
      apply((current) => reopenSide(current, placing));
    },
    dropGroup: (group: string) => {
      apply((current) => dropGroup(current, group));
    },
    /** A group's pin, or the left side's share of two, set (`withGroupOwn`). */
    setGroupOwn: (group: string, change: GroupOwn) => {
      apply((current) => withGroupOwn(current, group, change));
    },
    /** What each group keeps of its own, by its id. */
    groupOwn: state.groups ?? NO_GROUP_MEMBER_OWN,
    /** A tab marked as opened by a chat's agent (`markOpenedBy`). */
    markOpenedBy: (id: string, chat: ChatId) => {
      apply((current) => markOpenedBy(current, id, chat));
    },
    /** A tab marked as the one its chat was last sent a message from. */
    markPrompted: (id: string) => {
      apply((current) => markPrompted(current, id, Date.now()));
    },
    /** A group's two sides made one (`joinSides`). */
    joinSides: (group: string) => {
      apply((current) => joinSides(current, group));
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
     * A screen opened from a chat's tab (`openBesideChat`). Answers the tab
     * that shows it, and whether it is up on its side; nothing for a chat's
     * tab no group has.
     */
    openScreenBeside: (
      to: string,
      {
        openedBy,
        ...ask
      }: Omit<BesideAsk, "previous"> & {
        /** The chat whose agent opened it, whose last page it goes right after. */
        openedBy?: ChatId;
      },
    ): undefined | { front: boolean; id: string } => {
      const href = openLinkAddress(to);
      if (href === undefined) {
        return undefined;
      }
      return answer<undefined | { front: boolean; id: string }>((current) => {
        const group = current.tabs.find((tab) => tab.id === ask.chatTab)?.group;
        if (group === undefined) {
          return { state: current, value: undefined };
        }
        const id = newScreenId();
        const previous =
          openedBy === undefined
            ? undefined
            : previousOpenedIn(current, group, openedBy);
        const placed = openBesideChat(
          current,
          {
            group,
            href,
            id,
            isOpened: true,
            kind: "screen",
            ...(openedBy === undefined ? {} : { openedBy }),
          },
          { ...ask, ...(previous === undefined ? {} : { previous }) },
        );
        return {
          state: placed.state,
          value: { front: placed.front, id: placed.id },
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
