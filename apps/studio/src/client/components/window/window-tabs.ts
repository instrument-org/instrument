import {
  tabChatFiltersAtom,
  type WindowTab,
} from "@/client/atoms/window";
import {
  atom,
  type Atom,
  type SetStateAction,
  useAtomValue,
  useSetAtom,
} from "jotai";
import { selectAtom } from "jotai/utils";
import { isEqual } from "radashi";
import { createContext, useCallback, useContext, useMemo } from "react";
import { getGroupTabRouter } from "@/client/lib/group-tab-router-registry";
import {
  askTabs,
  keptMembersAtom,
  onTabsAnswered,
} from "@/client/lib/kept-state";
import {
  fileOfTabGroup,
  HOSTED_PAGE_GROUP_PREFIX,
  WINDOW_TABS_KEY,
} from "@/shared/kept-state";
import { screenOfHref } from "@/shared/instrument-screens";
import { workingTabOf } from "@/shared/working-tab";
import { type ChatId, StoreId } from "@instrument-org/workspace/client";

import { appTabsAtom, groupOfHref } from "./app-tabs";
import { type ChatFilters, NO_FILTERS } from "./chats";
import { type BesideAsk } from "./beside-chat";
import {
  backToOpenerOf,
  besideOf,
  chatUpIn,
  groupLayoutOf,
  type GroupLayout,
  everyTabId,
  type GroupOwn,
  moveTabTo,
  type Placing,
  reopenSide,
  restoreGroup,
  screenMoved,
  tabsIn,
  selectedTabIn,
  type WindowTabs,
} from "./tab-model";
import {
  NO_OPENERS,
  type Opening,
  prunedOpeners,
  type TabOpeners,
} from "./tab-openers";
import {
  applyTabCommand,
  type TabCommand,
  type TabOp,
  type TabOpArgs,
  type TabOpValue,
} from "./tab-ops";
import { joinTabGroups, splitTabGroups } from "./tab-members";
import { useIsGroupOpen } from "./open-groups";
import { openLinkAddress } from "./open-link-address";
import { standInTabsAtom } from "./stand-in-tabs";
import { asksPartOf, sameHref } from "./window-href";

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

/** A change this window asked of the main process, with what was true of the window as it asked. */
interface Asked {
  command: TabCommand;
  id: string;
  onScreen: string | undefined;
  openers: TabOpeners;
}

/**
 * The changes this window asked for that the main process, which owns the
 * tabs, has not answered yet, oldest first. Each is shown at once, laid over
 * the tabs as main last told them, and let go as its answer comes: what main
 * made of it is in the tabs by then, whether or not that is what this
 * window expected.
 */
const askedAtom = atom<readonly Asked[]>([]);
askedAtom.onMount = (set) =>
  onTabsAnswered((id) => {
    set((asked) => asked.filter((each) => each.id !== id));
  });

/** How many changes this window has asked of the tabs and not had answered. */
export const tabChangesAskedAtom = atom((get) => get(askedAtom).length);

let asks = 0;

/** The tabs this window last showed, which the next ones share what is the same with. */
let lastShown: WindowTabs | undefined;

/**
 * The tabs as the main process last told them, with what this window asked
 * since laid over. Whatever is the same as it was shown before is the very
 * object it was: main's word arrives as fresh copies of every tab in a group,
 * and a screen that watches its tab would take each copy for a change.
 */
const shownTabsAtom = atom((get) => {
  const now = get(askedAtom).reduce<WindowTabs>((tabs, ask) => {
    const { openers: _own, ...kept } = applyTabCommand(
      { ...tabs, openers: ask.openers },
      { onScreen: ask.onScreen },
      ask.command,
    ).state;
    return kept;
  }, get(keptTabsAtom));
  lastShown = lastShown === undefined ? now : sharingWith(lastShown, now);
  return lastShown;
});

/** `now`, made of `was`'s own objects wherever the two say the same. */
function sharingWith(was: WindowTabs, now: WindowTabs): WindowTabs {
  const before = new Map(was.tabs.map((tab) => [tab.id, tab]));
  const tabs = now.tabs.map((tab) => {
    const same = before.get(tab.id);
    return same !== undefined && isEqual(same, tab) ? same : tab;
  });
  const shared = {
    activeByGroup: isEqual(was.activeByGroup, now.activeByGroup)
      ? was.activeByGroup
      : now.activeByGroup,
    ...(now.besideByGroup === undefined
      ? {}
      : {
          besideByGroup: isEqual(was.besideByGroup, now.besideByGroup)
            ? was.besideByGroup
            : now.besideByGroup,
        }),
    ...(now.groups === undefined
      ? {}
      : { groups: isEqual(was.groups, now.groups) ? was.groups : now.groups }),
    tabs:
      tabs.length === was.tabs.length &&
      tabs.every((tab, at) => tab === was.tabs[at])
        ? was.tabs
        : tabs,
  } satisfies WindowTabs;
  return shared.tabs === was.tabs &&
    shared.activeByGroup === was.activeByGroup &&
    shared.besideByGroup === was.besideByGroup &&
    shared.groups === was.groups
    ? was
    : shared;
}

/** The tabs this window shows, with its own links between them. */
const storedTabsAtom = atom<WindowTabs>((get) => ({
  ...get(shownTabsAtom),
  openers: get(openersAtom),
}));

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
 * The window's tabs as a group drawn out of sight reads them, where one is
 * (`useTabsAtom`): the same object until something of that group's own
 * changes, so a change anywhere else in the window draws nothing of it. The
 * window's own tabs (`windowTabsAtom`) elsewhere.
 */
export const HeldTabsContext = createContext<Atom<WindowTabs> | null>(null);

/** The window's tabs as this part of the window reads them (`HeldTabsContext`). */
export function useTabsAtom(): Atom<WindowTabs> {
  return useContext(HeldTabsContext) ?? windowTabsAtom;
}

/** The window's tabs, changing only as something of `group`'s own does. */
export function heldTabsAtomOf(group: string): Atom<WindowTabs> {
  return selectAtom(
    windowTabsAtom,
    (state) => state,
    (a, b) =>
      sameLayout(groupLayoutOf(a, group), groupLayoutOf(b, group)) &&
      isEqual(a.groups?.[group], b.groups?.[group]),
  );
}

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
export const everyTabIdAtom = atom((get) => everyTabId(get(shownTabsAtom)));

/** No glints, one map for every reader. */
const NO_GLINTS: ReadonlyMap<string, number> = new Map();

/**
 * Empty new chat tabs whose composer glints once, by how many times it was
 * asked to, so asking again plays it again: one a new tab or New asked for
 * while an empty new chat tab was up, where nothing else on screen would
 * change (`useTabGroups`). `NewChatView` takes its tab out as the glint ends
 * or the composer goes, so a tab shown again never glints.
 */
export const glintingNewChatTabsAtom = atom(NO_GLINTS);

/**
 * One change to the tabs, by its name (`tab-ops.ts`), applied to them as they
 * are at that moment with the group on screen as it is then. Answers what
 * the change answers; nothing over a picture of a window.
 */
const applyAtom = atom(null, (get, set, command: TabCommand): unknown => {
  // A picture of a window changes nothing.
  if (get(standInTabsAtom) !== undefined) {
    return undefined;
  }
  const current = get(storedTabsAtom);
  const onScreen = get(groupOnScreenAtom);
  const { state: next, value } = applyTabCommand(
    current,
    { onScreen },
    command,
  );
  if (next === current) {
    return value;
  }
  const { openers = NO_OPENERS, ...kept } = next;
  set(openersAtom, prunedOpeners(openers, next.tabs));
  if (
    kept.tabs !== current.tabs ||
    kept.activeByGroup !== current.activeByGroup ||
    kept.besideByGroup !== current.besideByGroup ||
    kept.groups !== current.groups
  ) {
    // The main process owns the tabs and applies the change itself. What it
    // changes here is shown at once, until main says what it made of it.
    asks += 1;
    const asked: Asked = {
      command,
      id: asks.toString(),
      onScreen,
      openers: current.openers ?? NO_OPENERS,
    };
    if (askTabs(asked)) {
      set(askedAtom, (all) => [...all, asked]);
    } else {
      // With no one to ask, as in a test, the window keeps them itself.
      set(keptTabsAtom, kept);
    }
  }
  return value;
});

/** `applyAtom`, for what changes the tabs from outside a component: a driving script's new tab. */
export const tabsChangeAtom = applyAtom;

/** The tabs set whole, as a test starts from them: nothing a window does, which changes them one named change at a time. */
export const seedWindowTabsAtom = atom(null, (_get, set, tabs: WindowTabs) => {
  const { openers = NO_OPENERS, ...kept } = tabs;
  set(openersAtom, openers);
  set(keptTabsAtom, kept);
});

/** Asks one change of the tabs by name, and hands back what it answers. */
export type TabsChange = <K extends TabOp>(
  op: K,
  ...args: TabOpArgs<K>
) => TabOpValue<K> | undefined;

/**
 * Applies one change to the tabs as they are at that moment, with the group
 * on screen as it is then: for an effect or a listener that needs a setter
 * that never changes. Components otherwise use `useWindowTabs`.
 */
export function useWindowTabsChange(): TabsChange {
  const apply = useSetAtom(applyAtom);
  return useCallback<TabsChange>(
    (op, ...args) =>
      // What a change answers is known by its name, which the one atom
      // every change goes through cannot say.
      apply({ args, op }) as never,
    [apply],
  );
}

/**
 * A group's sides as they are laid out now (`groupLayoutOf`), the same object
 * until one of its tabs, which tab is up on a side, or which side has the
 * keyboard changes: a switch to another group leaves it as it was, and with
 * it everything the group draws from it.
 */
export function useGroupLayout(group: string): GroupLayout {
  const tabs = useTabsAtom();
  const layout = useMemo(
    () => selectAtom(tabs, (state) => groupLayoutOf(state, group), sameLayout),
    [group, tabs],
  );
  return useAtomValue(layout);
}

/** The tab a group is held to go by (`GroupOwn.lead`), read for the group alone. */
export function useGroupLead(group: string): string | undefined {
  const tabs = useTabsAtom();
  const lead = useMemo(
    () => selectAtom(tabs, (state) => state.groups?.[group]?.lead),
    [group, tabs],
  );
  return useAtomValue(lead);
}

/** The name a group was given (`GroupOwn.name`), read for the group alone. */
export function useGroupName(group: string): string | undefined {
  const word = useMemo(
    () =>
      selectAtom(windowTabsAtom, (state) => state.groups?.[group]?.name),
    [group],
  );
  return useAtomValue(word);
}

function sameLayout(a: GroupLayout, b: GroupLayout) {
  return (
    a.focused === b.focused &&
    a.sides.length === b.sides.length &&
    a.sides.every((side, index) => {
      const other = b.sides[index];
      return (
        other !== undefined &&
        side.up === other.up &&
        side.tabs.length === other.tabs.length &&
        side.tabs.every((tab, at) => tab === other.tabs[at])
      );
    })
  );
}

/**
 * The chat each group has up (`chatUpIn`), in the order of `groups`, one
 * group per line: the same array until one of them changes.
 */
export function useChatsUpIn(groups: string): readonly (ChatId | undefined)[] {
  const tabs = useTabsAtom();
  const chats = useMemo(
    () =>
      selectAtom(
        tabs,
        (state) =>
          groups === ""
            ? []
            : groups.split("\n").map((group) => chatUpIn(state, group)),
        (a, b) =>
          a.length === b.length && a.every((chat, at) => chat === b[at]),
      ),
    [groups, tabs],
  );
  return useAtomValue(chats);
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
  const state = useAtomValue(useTabsAtom());
  const groupOnScreen = useAtomValue(groupOnScreenAtom);
  const run = useWindowTabsChange();
  const isOpen = useIsGroupOpen();

  /**
   * Sends a tab to a screen, a step on in its history: a screen tab's router
   * walks, and the tab follows it as it lands, a chat's included; a page
   * becomes the screen.
   */
  const visitHref = (id: string, href: string) => {
    const router = getGroupTabRouter(id);
    if (!router) {
      run("tabToScreen", { href, id, newId: newScreenId() });
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
    /** Closes a tab; `up` comes up in its place where a step back named it (`closeTab`). */
    close: (id: string, options: { up?: string } = {}) => {
      run("closeTab", id, options);
    },
    /** One side of a group of two closed whole (`closeSide`). */
    closeSide: (group: string, side: 0 | 1) => {
      run("closeSide", group, side);
    },
    /** A closed side back as the side it was, its tab up, the keyboard where it was (`reopenSide`). */
    reopenSide: (placing: Parameters<typeof reopenSide>[1]) => {
      run("reopenSide", placing);
    },
    dropGroup: (group: string) => {
      run("dropGroup", group);
    },
    /** A page whose first navigation became a download: its tab goes back, or closes (`pageBecameDownload`). */
    pageBecameDownload: (id: string) => {
      run("pageBecameDownload", id);
    },
    /** A popup closed itself: its tab closes, and the opener's comes up when the popup's was up (`popupClosed`). */
    popupClosed: (id: string, opener: string) => {
      run("popupClosed", id, opener);
    },
    /** A group's pin, its project, the left side's share of two, its lead tab, or when it last came up, set (`withGroupOwn`). */
    setGroupOwn: (group: string, change: GroupOwn) => {
      run("withGroupOwn", group, change);
    },
    /** What each group keeps of its own, by its id. */
    groupOwn: state.groups ?? NO_GROUP_MEMBER_OWN,
    /** A tab marked as opened by a chat's agent (`markOpenedBy`). */
    markOpenedBy: (id: string, chat: ChatId) => {
      run("markOpenedBy", id, chat);
    },
    /** A tab marked as the one its chat was last sent a message from. */
    markPrompted: (id: string) => {
      run("markPrompted", id, Date.now());
    },
    /** A tab marked as the page an app's sign-in waits on, or unmarked (`markSignIn`). */
    markSignIn: (id: string, signIn: WindowTab["signIn"]) => {
      run("markSignIn", id, signIn);
    },
    /** A group's two sides made one (`joinSides`). */
    joinSides: (group: string) => {
      run("joinSides", group);
    },
    /** The side with the keyboard, in a group of two sides, moved to the other. */
    focusSide: (group: string, side: 0 | 1) => {
      run("focusSide", group, side);
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
      run("moveTabTo", move);
    },
    /**
     * A tab opened in a group as every open places one: on a side, right
     * after a tab, up with the keyboard when asked (`openInGroup`).
     */
    openIn: (
      tab: WindowTab,
      placing: Placing & { from?: Opening; select?: boolean },
    ) => {
      run("openInGroup", tab, placing);
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
      run("navigateScreenUp", { href, id: newScreenId() });
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
      return run("openOrFocusScreen", {
        ...(after === undefined ? {} : { after }),
        ...(from === undefined ? {} : { from }),
        ...(group === undefined ? {} : { group }),
        href,
        id: newScreenId(),
        select,
      });
    },
    /**
     * Brings up the tab of the group on screen already showing what an
     * address shows (`tabShowingIn`); false where none does.
     */
    selectShowing: (href: string): boolean =>
      run("selectShowing", href) ?? false,
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
      return run("openScreen", {
        ...(after === undefined ? {} : { after }),
        ...(from === undefined ? {} : { from }),
        ...(group === undefined ? {} : { group }),
        href,
        id: given ?? newScreenId(),
        select,
        ...(side === undefined ? {} : { side }),
      });
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
      const shown = run("openScreenBesideChat", {
        ask,
        href,
        id: newScreenId(),
        ...(openedBy === undefined ? {} : { openedBy }),
      });
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
      return run("handOverBeside", {
        chatTab,
        href,
        id: newScreenId(),
        openedBy,
      });
    },
    /**
     * A screen of its own right after the tab the group on screen has up,
     * as a link opened in a new tab lands: up at once, or waiting behind
     * when asked.
     */
    openBeside: (
      to: string,
      {
        atEnd = false,
        behind = false,
        from,
      }: {
        /** At the end of the side with the keyboard, opened from no tab (`OpenOptions.atEnd`). */
        atEnd?: boolean;
        behind?: boolean;
        /** The tab it was asked from, which it opens right after; left out, it was asked of the window, and opens after the tab up. */
        from?: string;
      } = {},
    ): string | undefined => {
      const href = openLinkAddress(to);
      if (href === undefined) {
        return undefined;
      }
      return run("openBeside", {
        atEnd,
        behind,
        from,
        href,
        id: newScreenId(),
      });
    },
    /** The tab Back returns to from the start of a tab a link opened (`backToOpenerOf`). */
    backToOpenerOf: (id: string) => backToOpenerOf(state, id),
    replace: (id: string, next: WindowTab) => {
      run("replaceTab", id, next);
    },
    restoreGroup: (
      group: string,
      tabs: WindowTab[],
      ups?: Parameters<typeof restoreGroup>[3],
    ) => {
      run("restoreGroup", group, tabs, ups);
    },
    /** A closed tab back where it stood in its group, up in it. */
    reopen: (tab: WindowTab, index: number) => {
      run("reopenTab", { index, tab });
    },
    /** The person sent a tab to an address of their own (`startedOver`). */
    startedOver: (id: string) => {
      run("startedOver", id);
    },
    /** One tab up on its side, the keyboard staying where it is (`raiseTab`). */
    raise: (id: string) => {
      run("raiseTab", id);
    },
    /** One tab up in its group, with the keyboard, where it was not the person's pick of it (`selectTab`). */
    bringUp: (id: string) => {
      run("selectTab", id);
    },
    /** The tab the person picked, up in its group, with the keyboard: on screen when the group is (`pickTab`). */
    select: (id: string) => {
      run("pickTab", id);
    },
    /**
     * A step along a screen tab's own trail: the address it steps to, which
     * the tab now stands on, or nothing when it has none left.
     */
    stepTab: (id: string, direction: -1 | 1): string | undefined => {
      const router = getGroupTabRouter(id);
      if (!router) {
        return run("stepTrail", id, direction);
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
      run("stepVisit", id, direction),
    /** The tab a group has up, or would come on screen at. */
    selectedTabIn: (group: string | undefined) => selectedTabIn(state, group),
    /** The tabs of the group on screen, in strip order. */
    tabs: tabsIn(state, groupOnScreen),
    /** Sends a screen tab to another address, a step on in its history. */
    visitHref,
    /** A screen tab's router moved; the tab follows it. */
    screenMoved: (id: string, moved: Parameters<typeof screenMoved>[2]) => {
      run("screenMoved", id, moved);
    },
  };
}
