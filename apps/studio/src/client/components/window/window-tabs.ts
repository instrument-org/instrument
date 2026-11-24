import {
  type BrowserTab,
  tabChatFiltersAtom,
  type WindowTab,
} from "@/client/atoms/window";
import { atom, type SetStateAction, useAtomValue, useSetAtom } from "jotai";
import { z } from "zod";

import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import { keptMembersAtom } from "@/client/lib/kept-state";
import {
  fileOfTabGroup,
  HOSTED_PAGE_GROUP_PREFIX,
  NO_GROUP_MEMBER,
  WINDOW_TABS_KEY,
} from "@/shared/kept-state";
import { screenOfHref } from "@/shared/instrument-screens";
import { workingTabOf } from "@/shared/working-tab";
import { type ChatId, StoreId } from "@instrument-org/workspace/client";

import { appTabsAtom, groupOfHref } from "./app-tabs";
import { type ChatFilters, NO_FILTERS } from "./chats";
import {
  type BesideAsk,
  handOverBesideChat,
  openBesideChat,
  previousOpenedIn,
} from "./beside-chat";
import {
  addPages,
  addScreen,
  backToOpenerOf,
  besideOf,
  chatUpIn,
  groupLayoutOf,
  closeSide,
  closeTab,
  draftOfTab,
  dropGroup,
  everyTabId,
  focusSide,
  isNewChatTab,
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
  pageBecameDownload,
  pageNavigated,
  pageTakesOver,
  openingFrom,
  patchPage,
  pickTab,
  type Placing,
  raiseTab,
  reopenSide,
  reopenTab,
  reorderGroup,
  replaceTab,
  restoreGroup,
  screenMoved,
  selectTab,
  startedOver,
  stepTrail,
  stepVisit,
  tabsIn,
  selectedTabIn,
  tabShowingIn,
  tabToScreen,
  type WindowTabs,
  withGroupOwn,
} from "./tab-model";
import {
  NO_OPENERS,
  type Opening,
  prunedOpeners,
  type TabOpeners,
} from "./tab-openers";
import { useIsGroupOpen } from "./open-groups";
import { openLinkAddress } from "./open-link-address";
import { standInTabsAtom } from "./stand-in-tabs";
import { asksPartOf, sameHref } from "./window-href";

/** A kept group's shape; its tabs' own fields are this module's to write and read. */
const TabGroupMemberSchema = z.object({
  focused: z.number().int().min(0),
  pinned: z.boolean().optional(),
  project: z.string().optional(),
  share: z.number().optional(),
  shownAt: z.number().optional(),
  sides: z
    .array(
      z.object({
        tabs: z.array(z.looseObject({ id: z.string(), kind: z.string() })),
        up: z.string().optional(),
      }),
    )
    .min(1),
});

/**
 * Every group's tabs on this computer, one list across them, kept across
 * launches. Each group is one member of the kept file, under its own id, in
 * the shape the agent reads a group in: its sides, each its tabs in strip
 * order and the one up, which side has the keyboard, and its own pin,
 * project, share and when it last came up. A tab keeps neither its group nor its side, which the member says.
 * Written only here, through the functions of `tab-model.ts`.
 */
const keptTabsAtom = keptMembersAtom<WindowTabs>(
  fileOfTabGroup,
  WINDOW_TABS_KEY,
  {
    join: joinTabGroups,
    split: splitTabGroups,
  },
);

/** Which tab each was opened from, as this window saw it, until it loads again. */
const openersAtom = atom<TabOpeners>(NO_OPENERS);

/** The kept tabs with this window's own links between them. */
const storedTabsAtom = atom<WindowTabs>((get) => ({
  ...get(keptTabsAtom),
  openers: get(openersAtom),
}));

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
          // A side past the second, which a later layout may keep, stands
          // on the right, so none of its tabs is dropped.
          ...(at >= 1 ? { side: 1 } : {}),
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
      ...(member.project === undefined ? {} : { project: member.project }),
      ...(member.share === undefined ? {} : { share: member.share }),
      ...(member.shownAt === undefined ? {} : { shownAt: member.shownAt }),
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

/**
 * What the chat list of the tab up in the group on screen is narrowed to,
 * and narrowing it: for what acts on the tab in front rather than from
 * inside one. Nothing, with no group on screen.
 */
export const chatFiltersUpAtom = atom(
  (get) => {
    const up = selectedTabIn(get(windowTabsAtom), get(groupOnScreenAtom));
    return up ? get(tabChatFiltersAtom(up.id)) : NO_FILTERS;
  },
  (get, set, update: SetStateAction<ChatFilters>) => {
    const up = selectedTabIn(get(windowTabsAtom), get(groupOnScreenAtom));
    if (up) {
      set(tabChatFiltersAtom(up.id), update);
    }
  },
);

/** Every tab id the window holds, past and future visits included, so nothing is opened twice. */
export const everyTabIdAtom = atom((get) => everyTabId(get(keptTabsAtom)));

/** No tabs, one set for every reader. */
const NO_TAB_IDS: ReadonlySet<string> = new Set();

/**
 * Empty new chat tabs this window opened since it loaded whose composer has
 * not come up yet. Their arrival is the one moment a new chat's composer
 * glints (`NewChatView`, which takes its tab out as it comes up), so a tab
 * restored at launch, one shown again, and one naming a kept draft never do.
 */
export const arrivingNewChatTabsAtom = atom(NO_TAB_IDS);

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
    if (next === current) {
      return;
    }
    const { openers = NO_OPENERS, ...kept } = next;
    set(openersAtom, prunedOpeners(openers, next.tabs));
    if (
      kept.tabs !== current.tabs ||
      kept.activeByGroup !== current.activeByGroup ||
      kept.besideByGroup !== current.besideByGroup ||
      kept.groups !== current.groups
    ) {
      set(keptTabsAtom, kept);
    }
    const before = new Set(current.tabs.map((tab) => tab.id));
    const arriving = next.tabs.filter(
      (tab) =>
        !before.has(tab.id) &&
        isNewChatTab(tab) &&
        draftOfTab(tab) === undefined,
    );
    if (arriving.length > 0) {
      set(
        arrivingNewChatTabsAtom,
        (ids) => new Set([...ids, ...arriving.map((tab) => tab.id)]),
      );
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
      // A router hears its history only while its screen is drawn, and
      // drawn again it stays where it last loaded, so one out of sight loads
      // here.
      if (!sameHref(router.latestLocation.href, href)) {
        void router.load();
      }
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
      placing: { after?: string; from?: Opening } = {},
    ) => {
      apply((current) => addPages(current, pages, placing));
    },
    /** Closes a tab; `up` comes up in its place where a step back named it (`closeTab`). */
    close: (id: string, options: { up?: string } = {}) => {
      apply((current) => closeTab(current, id, options));
    },
    /** One side of a group of two closed whole (`closeSide`). */
    closeSide: (group: string, side: 0 | 1) => {
      apply((current) => closeSide(current, group, side));
    },
    /** A closed side back as the side it was, its tab up, the keyboard where it was (`reopenSide`). */
    reopenSide: (placing: Parameters<typeof reopenSide>[1]) => {
      apply((current) => reopenSide(current, placing));
    },
    dropGroup: (group: string) => {
      apply((current) => dropGroup(current, group));
    },
    /** A page whose first navigation became a download: its tab goes back, or closes (`pageBecameDownload`). */
    pageBecameDownload: (id: string) => {
      apply((current) => pageBecameDownload(current, id));
    },
    /** A group's pin, its project, the left side's share of two, or when it last came up, set (`withGroupOwn`). */
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
    openIn: (
      tab: WindowTab,
      placing: Placing & { from?: Opening; select?: boolean },
    ) => {
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
        from,
        select = false,
      }: {
        /** The tab a new one opens right after, on that tab's side. */
        after?: string;
        group?: string;
        /** Why it opens (`Opening`). */
        from?: Opening;
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
          ...(from === undefined ? {} : { from }),
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
          ? { state: pickTab(current, tab.id), value: true }
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
        from,
        select = false,
        side,
      }: {
        /** The tab it opens right after, on that tab's side. */
        after?: string;
        group?: string;
        /** The tab's id, for one the strip already draws by it: a file held over it. */
        id?: string;
        /** Why it opens (`Opening`). */
        from?: Opening;
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
            ...(from === undefined ? {} : { from }),
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
     * tab no group has. A built-in page already there walks to the part
     * asked for.
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
      const shown = answer<
        undefined | { front: boolean; id: string; was: string | undefined }
      >((current) => {
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
            kind: "screen",
            ...(openedBy === undefined ? {} : { openedBy }),
          },
          { ...ask, ...(previous === undefined ? {} : { previous }) },
        );
        const there = current.tabs.find((tab) => tab.id === placed.id);
        return {
          state: placed.state,
          value: {
            front: placed.front,
            id: placed.id,
            was: there?.kind === "screen" ? there.href : undefined,
          },
        };
      }, undefined);
      if (shown === undefined) {
        return undefined;
      }
      if (
        shown.was !== undefined &&
        screenOfHref(href) !== undefined &&
        asksPartOf(href, shown.was)
      ) {
        visitHref(shown.id, href);
      }
      return { front: shown.front, id: shown.id };
    },
    /**
     * A file a chat's reply handed over, beside the chat's tab
     * (`handOverBesideChat`): the group's tab showing it brought up, or a
     * tab of the agent's own. Nothing for a chat's tab no group has.
     */
    handOverBeside: (
      to: string,
      { chatTab, openedBy }: { chatTab: string; openedBy: ChatId },
    ): undefined | { front: boolean; id: string; isNew: boolean } => {
      const href = openLinkAddress(to);
      if (href === undefined) {
        return undefined;
      }
      return answer<undefined | { front: boolean; id: string; isNew: boolean }>(
        (current) => {
          if (!current.tabs.some((tab) => tab.id === chatTab && tab.group)) {
            return { state: current, value: undefined };
          }
          const placed = handOverBesideChat(current, {
            chatTab,
            href,
            id: newScreenId(),
            openedBy,
          });
          return {
            state: placed.state,
            value: { front: placed.front, id: placed.id, isNew: placed.isNew },
          };
        },
        undefined,
      );
    },
    /**
     * A screen of its own right after the tab the group on screen has up,
     * as a link opened in a new tab lands: up at once, or waiting behind
     * when asked.
     */
    openBeside: (
      to: string,
      {
        behind = false,
        from,
      }: {
        behind?: boolean;
        /** The tab it was asked from, which it opens right after; left out, it was asked of the window, and opens after the tab up. */
        from?: string;
      } = {},
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
        const opening = openingFrom(current, onScreen, from);
        return {
          state: addScreen(current, {
            ...(opening.tab === undefined ? {} : { after: opening.tab }),
            from: opening,
            group: onScreen,
            href,
            id,
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
      from,
      group,
      page,
      replacing,
      select = false,
      side,
    }: {
      after?: string;
      from?: Opening;
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
          ...(from === undefined ? {} : { from }),
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
    /** The tab Back returns to from the start of a tab a link opened (`backToOpenerOf`). */
    backToOpenerOf: (id: string) => backToOpenerOf(state, id),
    /** A group's tabs in a new order, by their strip keys. */
    reorder: (keys: string[], group: string) => {
      apply((current) => reorderGroup(current, group, keys));
    },
    replace: (id: string, next: WindowTab) => {
      apply((current) => replaceTab(current, id, next));
    },
    restoreGroup: (
      group: string,
      tabs: WindowTab[],
      ups?: Parameters<typeof restoreGroup>[3],
    ) => {
      apply((current) => restoreGroup(current, group, tabs, ups));
    },
    /** A closed tab back where it stood in its group, up in it. */
    reopen: (tab: WindowTab, index: number) => {
      apply((current) => reopenTab(current, { index, tab }));
    },
    /** The person sent a tab to an address of their own (`startedOver`). */
    startedOver: (id: string) => {
      apply((current) => startedOver(current, id));
    },
    /** One tab up on its side, the keyboard staying where it is (`raiseTab`). */
    raise: (id: string) => {
      apply((current) => raiseTab(current, id));
    },
    /** One tab up in its group, with the keyboard, where it was not the person's pick of it (`selectTab`). */
    bringUp: (id: string) => {
      apply((current) => selectTab(current, id));
    },
    /** The tab the person picked, up in its group, with the keyboard: on screen when the group is (`pickTab`). */
    select: (id: string) => {
      apply((current) => pickTab(current, id));
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
