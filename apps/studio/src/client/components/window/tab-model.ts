import {
  type BrowserTab,
  newTabHrefOf,
  type WindowTab,
} from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { type ChatId } from "@instrument-org/workspace/client";
import { omit } from "radashi";
import { HOSTED_PAGE_GROUP_PREFIX } from "@/shared/kept-state";

import { computerTabOf } from "./file-tabs";
import { historyOf, stepTabVisit, visitInTab } from "./tab-history";
import {
  addressOfTab,
  forgetOpeners,
  handOnOpener,
  lastOpenedFrom,
  nextUpAfter,
  NO_OPENERS,
  type Opening,
  openerKeyOf,
  switchedTabs,
  type TabOpeners,
  withOpened,
} from "./tab-openers";
import {
  matchScreen,
  sameHref,
  showsSame,
  showsSameThing,
} from "./window-href";

/**
 * What this computer has open: every group's tabs in strip order, each on
 * one of its group's one or two sides, and the tab up on each side. A group
 * is a record of its own, keyed by an id minted once (`newGroupKey`) and
 * never read for anything: no group is a chat's or a draft's. A chat is
 * only what a tab's address points at, and any number of tabs may point at
 * one. Which group a window has on screen is not kept here, since it is
 * whatever the window's tab up stands on.
 *
 * Every change to it is one of the functions below, each pure.
 */
export interface WindowTabs {
  /**
   * The tab up on the side with the keyboard, in each group, by its key;
   * the side it stands on is the side with the keyboard. `groupLayoutOf`
   * says what a group with none has up.
   */
  activeByGroup: Record<string, string>;
  /** The tab up on the other side, in each group of two sides. */
  besideByGroup?: Record<string, string>;
  /** What a group keeps of its own beside its tabs, by its id. */
  groups?: Record<string, GroupOwn>;
  /** Which tab each was opened from, as this window saw it; never kept on disk. */
  openers?: TabOpeners;
  tabs: WindowTab[];
}

/** What a group keeps of its own: its pin, the project it was made in, how its two sides are sized (`sideShare`), and when it last came up. */
export interface GroupOwn {
  /** The side sized as a chat while the group has two, set as it gets them (`withChatSides`). */
  chatSide?: 0 | 1;
  pinned?: true;
  /** The project whose set of groups it was made in, by its id. */
  project?: string;
  /** The left side's share of the row past the gutter, as the person dragged it. */
  share?: number;
  /** When a window last came to stand on it, in ms, which the agent's list says. */
  shownAt?: number;
}

/** A group's own record with one field changed, a field left empty taken off. */
export function withGroupOwn(
  state: WindowTabs,
  group: string,
  change: GroupOwn,
): WindowTabs {
  const merged: GroupOwn = { ...state.groups?.[group], ...change };
  const own: GroupOwn = {
    ...(merged.chatSide === undefined ? {} : { chatSide: merged.chatSide }),
    ...(merged.pinned ? { pinned: true } : {}),
    ...(merged.project === undefined ? {} : { project: merged.project }),
    ...(merged.share === undefined ? {} : { share: merged.share }),
    ...(merged.shownAt === undefined ? {} : { shownAt: merged.shownAt }),
  };
  const { [group]: _was, ...others } = state.groups ?? {};
  return {
    ...state,
    groups:
      Object.keys(own).length === 0 ? others : { ...others, [group]: own },
  };
}

/** One side of a group: its tabs in strip order, and the one up. */
export interface GroupSide {
  tabs: WindowTab[];
  up: string | undefined;
}

/**
 * A group as it is laid out: one side or two, the left first, and which of
 * them has the keyboard. A group with no tabs is one empty side.
 */
export interface GroupLayout {
  focused: 0 | 1;
  sides: GroupSide[];
}

/** The side a tab stands on, as kept: 0, the left, unless it says 1. */
export function sideOf(tab: WindowTab): 0 | 1 {
  return tab.side === 1 ? 1 : 0;
}

/**
 * A group's layout, read from the tabs: its sides, each with its tabs in
 * strip order and the one up there, and the side with the keyboard. A side's
 * up is the tab chosen there, else its first. A group whose left side is
 * empty is drawn as its right side alone, as `normalizeSides` keeps it.
 */
export function groupLayoutOf(state: WindowTabs, group: string): GroupLayout {
  const own = tabsIn(state, group);
  const left = own.filter((tab) => sideOf(tab) === 0);
  const right = own.filter((tab) => sideOf(tab) === 1);
  const lists = left.length === 0 || right.length === 0 ? [own] : [left, right];
  const active = own.find((tab) => tab.id === state.activeByGroup[group]);
  const at = active ? lists.findIndex((tabs) => tabs.includes(active)) : 0;
  const focused = at === 1 ? 1 : 0;
  const beside = own.find((tab) => tab.id === state.besideByGroup?.[group]);
  return {
    focused,
    sides: lists.map((tabs, index) => {
      const chosen = index === focused ? active : beside;
      return {
        tabs,
        up: chosen && tabs.includes(chosen) ? chosen.id : tabs[0]?.id,
      };
    }),
  };
}

/** Which side of its group's layout a tab stands on; none for a tab not there. */
export function sideIndexOf(
  layout: GroupLayout,
  id: string,
): 0 | 1 | undefined {
  const at = layout.sides.findIndex((side) =>
    side.tabs.some((tab) => tab.id === id),
  );
  return at === -1 ? undefined : at === 1 ? 1 : 0;
}

/** What a side's tab up is, as a split is sized by it: a New Tab with nothing written is either. */
function sizedAs(tab: undefined | WindowTab): "blank" | "chat" | "page" {
  if (tab === undefined || isHomeTab(tab)) {
    return "blank";
  }
  return isChatTab(tab) || isNewChatTab(tab) ? "chat" : "page";
}

/**
 * Which of a group's two sides is sized as a chat, by what each has up: the
 * chat, beside a page. A New Tab takes the other part from what is beside
 * it. None for two alike, or for a group of one side.
 */
export function chatSideOf({ sides }: GroupLayout): 0 | 1 | undefined {
  if (sides.length < 2) {
    return undefined;
  }
  const [left, right] = sides.map((side) =>
    sizedAs(side.tabs.find((tab) => tab.id === side.up)),
  );
  if (left === right) {
    return undefined;
  }
  return left === "chat" || right === "page" ? 0 : 1;
}

/** Whether one of a group's sides was a New Tab alone, which something else has taken the place of. */
function tookNewTabsPlace(was: GroupLayout, now: GroupLayout): boolean {
  const open = new Set(
    now.sides.flatMap((side) => side.tabs.map((tab) => tab.id)),
  );
  return was.sides.some(
    ({ tabs: [only, ...rest] }) =>
      only !== undefined &&
      rest.length === 0 &&
      isHomeTab(only) &&
      !open.has(only.id),
  );
}

/** The groups whose tabs stand on both sides. */
function splitGroups({ tabs }: WindowTabs): Set<string> {
  const left = new Set<string>();
  const right = new Set<string>();
  for (const tab of tabs) {
    if (tab.group !== undefined) {
      (sideOf(tab) === 0 ? left : right).add(tab.group);
    }
  }
  return new Set([...left].filter((group) => right.has(group)));
}

/**
 * The tabs after a change, with the side each group sizes as a chat
 * (`chatSideOf`) set as the group gets two sides, however it got them, and
 * dropped as it goes back to one. It stays as it is while other tabs come
 * up, so the gutter does not move under the person; a split with none set
 * gets one when something takes the place of a New Tab that was a whole side.
 */
export function withChatSides(was: WindowTabs, now: WindowTabs): WindowTabs {
  if (was.tabs === now.tabs) {
    return now;
  }
  const before = splitGroups(was);
  const after = splitGroups(now);
  let next = now;
  for (const group of after) {
    const layout = groupLayoutOf(now, group);
    const isNew =
      !before.has(group) ||
      (now.groups?.[group]?.chatSide === undefined &&
        tookNewTabsPlace(groupLayoutOf(was, group), layout));
    const chatSide = chatSideOf(layout);
    if (isNew && now.groups?.[group]?.chatSide !== chatSide) {
      next = withGroupOwn(next, group, { chatSide });
    }
  }
  for (const group of before) {
    if (!after.has(group) && next.groups?.[group]?.chatSide !== undefined) {
      next = withGroupOwn(next, group, { chatSide: undefined });
    }
  }
  return next;
}

/**
 * The tab up on the other side from a tab, in a group of two sides: what a
 * chat's next message carries, beside it. None in a group of one side.
 */
export function besideOf(state: WindowTabs, id: string): undefined | WindowTab {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (tab?.group === undefined) {
    return undefined;
  }
  const layout = groupLayoutOf(state, tab.group);
  const side = sideIndexOf(layout, id);
  if (side === undefined || layout.sides.length < 2) {
    return undefined;
  }
  const other = layout.sides[1 - side]?.up;
  return state.tabs.find((entry) => entry.id === other);
}

/**
 * A group's sides kept as `groupLayoutOf` reads them: a right side with no
 * left becomes the left, and a group of one side keeps no other side's up.
 */
function normalizeSides(state: WindowTabs, group: string): WindowTabs {
  const own = tabsIn(state, group);
  const hasLeft = own.some((tab) => sideOf(tab) === 0);
  const hasRight = own.some((tab) => sideOf(tab) === 1);
  let next = state;
  if (hasRight && !hasLeft) {
    next = {
      ...next,
      tabs: next.tabs.map((tab) => {
        if (tab.group !== group || tab.side === undefined) {
          return tab;
        }
        const { side: _right, ...rest } = tab;
        return rest;
      }),
    };
  }
  if ((!hasLeft || !hasRight) && next.besideByGroup?.[group] !== undefined) {
    const { [group]: _gone, ...besideByGroup } = next.besideByGroup;
    next = { ...next, besideByGroup };
  }
  return next;
}

/** Where a tab goes in a group: on which side, and after which tab there. */
export interface Placing {
  /** The tab it opens right after, whose side it takes unless a side is named. */
  after?: string;
  group: string;
  /**
   * The side: `same`, the side of `after` or else the side with the
   * keyboard; `other`, the other one, made when the group has one side; or
   * a side by its place, 1 making the second side where there is none.
   */
  side?: "other" | "same" | 0 | 1;
}

/**
 * The side a tab placed in a group stands on, as kept, and the tab it goes
 * after there, if that tab is on that side.
 */
function placeIn(
  state: WindowTabs,
  { after, group, side = "same" }: Placing,
): { after: string | undefined; side: 0 | 1 } {
  const layout = groupLayoutOf(state, group);
  const afterSide =
    after === undefined ? undefined : sideIndexOf(layout, after);
  const same = afterSide ?? layout.focused;
  const target =
    side === "same" ? same : side === "other" ? (same === 1 ? 0 : 1) : side;
  // In a group of one side, its tabs are kept on the left, whatever they say.
  const kept: 0 | 1 = layout.sides.length === 1 && target === 0 ? 0 : target;
  return {
    after: afterSide === target ? after : undefined,
    side: kept,
  };
}

/**
 * The tabs with one more in a group, on a side: right after the tab named
 * there, or at the end of that side's tabs, or of the group's where the side
 * has none yet.
 */
function insertInGroup(
  state: WindowTabs,
  tab: WindowTab,
  placing: Placing,
): WindowTabs {
  const { after, side } = placeIn(state, placing);
  const { side: _was, ...rest } = tab;
  const placed: WindowTab = {
    ...rest,
    group: placing.group,
    ...(side === 1 ? { side: 1 as const } : {}),
  };
  return { ...state, tabs: spliceIn(state.tabs, placed, { after, side }) };
}

/** A tab put into the list at its place among its group's tabs on a side, by index or after a tab. */
function spliceIn(
  tabs: WindowTab[],
  tab: WindowTab,
  { after, index, side }: { after?: string; index?: number; side: 0 | 1 },
): WindowTab[] {
  const sideTabs = tabs.filter(
    (entry) => entry.group === tab.group && sideOf(entry) === side,
  );
  if (after !== undefined) {
    return insertAfter(tabs, tab, after);
  }
  const before = index === undefined ? undefined : sideTabs[index];
  if (before) {
    const at = tabs.indexOf(before);
    return tabs.toSpliced(at, 0, tab);
  }
  const last =
    sideTabs.at(-1) ?? tabs.findLast((entry) => entry.group === tab.group);
  return last ? insertAfter(tabs, tab, last.id) : [...tabs, tab];
}

/**
 * A new tab opened in a group, as every open places one (see `Placing`),
 * and up there with the keyboard when asked. Nothing else moves: the tab up
 * on each side stays up unless this is chosen.
 */
export function openInGroup(
  state: WindowTabs,
  tab: WindowTab,
  {
    from,
    select = false,
    isFront = select,
    ...placing
  }: Placing & {
    /** Why it opens, which links it to the tab it opened from (`TabOpeners`). */
    from?: Opening;
    /** Whether it comes to the front of its side, for a caller that raises it there itself. */
    isFront?: boolean;
    select?: boolean;
  },
): WindowTabs {
  const layout = groupLayoutOf(state, placing.group);
  const { side: at } = placeIn(state, placing);
  const side = layout.sides[at];
  const links = state.openers ?? NO_OPENERS;
  const source =
    from?.tab === undefined
      ? undefined
      : side?.tabs.find((entry) => entry.id === from.tab);
  const after =
    source && !isFront
      ? lastOpenedFrom(side?.tabs ?? [], source.id, links)
      : placing.after;
  const added = normalizeSides(
    insertInGroup(state, tab, {
      ...placing,
      ...(after === undefined ? {} : { after }),
    }),
    placing.group,
  );
  const linked =
    from === undefined
      ? added
      : {
          ...added,
          openers: withOpened(links, {
            isFront,
            opening: from,
            side: side?.tabs ?? [],
            source,
            tab,
            up: side?.tabs.find((entry) => entry.id === side.up),
          }),
        };
  return select ? selectTab(linked, tab.id) : linked;
}

/**
 * Why the person's open into a group is there (`Opening`): a link in the
 * group's tab `from`, else something asked of the window with a tab up.
 */
export function openingFrom(
  state: WindowTabs,
  group: string | undefined,
  from: string | undefined,
): Exclude<Opening, { reason: "newTab" }> {
  if (
    from !== undefined &&
    state.tabs.some((tab) => tab.id === from && tab.group === group)
  ) {
    return { reason: "link", tab: from };
  }
  const up = selectedTabIn(state, group)?.id;
  return { reason: "asked", ...(up === undefined ? {} : { tab: up }) };
}

/** The tabs of the side a tab stands on, in strip order, and the one up there. */
function sideWith(state: WindowTabs, tab: WindowTab): GroupSide {
  const layout =
    tab.group === undefined ? undefined : groupLayoutOf(state, tab.group);
  const at = layout && sideIndexOf(layout, tab.id);
  return (
    (at === undefined ? undefined : layout?.sides[at]) ?? {
      tabs: [],
      up: undefined,
    }
  );
}

/**
 * The tab the person picked, up with the keyboard (`selectTab`): what the
 * side's tabs were opened from is forgotten where the pick starts on
 * something else (`switchedTabs`).
 */
export function pickTab(state: WindowTabs, id: string): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  const picked = selectTab(state, id);
  if (!tab || !state.openers) {
    return picked;
  }
  const side = sideWith(state, tab);
  const was = side.tabs.find((entry) => entry.id === side.up);
  return was
    ? { ...picked, openers: switchedTabs(state.openers, side.tabs, was, tab) }
    : picked;
}

/**
 * The person sent a tab to an address of their own, so what its side's tabs
 * were opened from is forgotten: but not the first thing a new tab at the
 * side's end is sent to, which is a quick look-up.
 */
export function startedOver(state: WindowTabs, id: string): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || !state.openers) {
    return state;
  }
  const side = sideWith(state, tab);
  return isHomeTab(tab) && side.tabs.at(-1)?.id === id
    ? state
    : { ...state, openers: forgetOpeners(state.openers, side.tabs) };
}

/**
 * The tab Back returns to from the start of a tab a link opened, as
 * Chromium's back-to-opener has it: the one the link was in, while it is on
 * the same side and at the address it had.
 */
export function backToOpenerOf(
  state: WindowTabs,
  id: string,
): undefined | WindowTab {
  const tab = state.tabs.find((entry) => entry.id === id);
  const source = tab && state.openers?.sources[openerKeyOf(tab)];
  if (!source) {
    return undefined;
  }
  return sideWith(state, tab).tabs.find(
    (entry) =>
      openerKeyOf(entry) === source.tab &&
      (entry.kind === "screen"
        ? showsSame(entry.href, source.at)
        : addressOfTab(entry) === source.at),
  );
}

/**
 * A tab taken out of its group's list as it closes or moves: the side it
 * leaves has the next one up (`nextUpAfter`), where it was up; a side
 * it leaves empty gives the keyboard to the other side, which becomes the
 * whole group once its sides are normalized.
 */
function takeOut(state: WindowTabs, id: string): WindowTabs {
  const closing = state.tabs.find((tab) => tab.id === id);
  if (!closing) {
    return state;
  }
  const remaining = state.tabs.filter((tab) => tab.id !== id);
  const { group } = closing;
  if (group === undefined) {
    return { ...state, tabs: remaining };
  }
  const links = state.openers ?? NO_OPENERS;
  const openers = state.openers && handOnOpener(state.openers, closing);
  const linked = openers ? { ...state, openers } : state;
  const layout = groupLayoutOf(state, group);
  const at = sideIndexOf(layout, id) ?? 0;
  const side = layout.sides[at];
  if (side?.up !== id) {
    return { ...linked, tabs: remaining };
  }
  const next = nextUpAfter(side.tabs, id, links);
  const { [group]: _active, ...activeByGroup } = state.activeByGroup;
  const { [group]: _beside, ...besideByGroup } = state.besideByGroup ?? {};
  const other = layout.sides[at === 0 ? 1 : 0]?.up;
  if (at === layout.focused) {
    const active = next?.id ?? other;
    return {
      ...linked,
      activeByGroup:
        active === undefined
          ? activeByGroup
          : { ...activeByGroup, [group]: active },
      besideByGroup:
        next === undefined || other === undefined
          ? besideByGroup
          : { ...besideByGroup, [group]: other },
      tabs: remaining,
    };
  }
  return {
    ...linked,
    besideByGroup:
      next === undefined
        ? besideByGroup
        : { ...besideByGroup, [group]: next.id },
    tabs: remaining,
  };
}

/**
 * A tab moved to a group and a side, at a place among that side's tabs (its
 * end when past them or left out): within its strip, to the other side, or
 * to another group. The side it leaves gives way as on a close, and the side
 * 1 of a group of one side is a second side made for it. With `split`, side
 * 0 of a group of one side is a second side made for it too, on the left,
 * the group's other tabs moving to the right. Up and with the keyboard when
 * asked.
 */
export function moveTabTo(
  state: WindowTabs,
  {
    group,
    id,
    index,
    select = false,
    side,
    split = false,
  }: {
    group: string;
    id: string;
    index?: number;
    select?: boolean;
    side: 0 | 1;
    split?: boolean;
  },
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab) {
    return state;
  }
  const from = tab.group;
  const moved = from !== undefined && from !== group ? { movedFrom: from } : {};
  // The side is read from the layout before the tab leaves it, so moving a
  // left side's last tab to the right makes one side, not two.
  const target = groupLayoutOf(state, group);
  if (split && side === 0 && target.sides.length === 1) {
    const out = takeOut(state, id);
    const others = out.tabs.map((entry) =>
      entry.group === group ? { ...entry, side: 1 as const } : entry,
    );
    if (!others.some((entry) => entry.group === group)) {
      return moveTabTo(state, { group, id, select, side: 0 });
    }
    const { side: _was, ...rest } = tab;
    let next: WindowTabs = {
      ...out,
      tabs: spliceIn(others, { ...rest, ...moved, group }, { side: 0 }),
    };
    next = normalizeSides(next, group);
    if (from !== undefined && from !== group) {
      next = normalizeSides(next, from);
    }
    return select ? selectTab(next, id) : next;
  }
  const kept: 0 | 1 =
    target.sides.length === 1 && side === 0
      ? 0
      : target.sides.length === 1 && side === 1
        ? sideOf(tab) === 1 && from === group
          ? 0
          : 1
        : side;
  const out = takeOut(state, id);
  const { side: _was, ...rest } = tab;
  const placed: WindowTab = {
    ...rest,
    ...moved,
    group,
    ...(kept === 1 ? { side: 1 as const } : {}),
  };
  let next: WindowTabs = {
    ...out,
    tabs: spliceIn(out.tabs, placed, { index, side: kept }),
    // Along its own strip it keeps what it was opened from.
    ...(from === group && sideOf(tab) === kept
      ? { openers: state.openers }
      : {}),
  };
  next = normalizeSides(next, group);
  if (from !== undefined && from !== group) {
    next = normalizeSides(next, from);
  }
  return select ? selectTab(next, id) : next;
}

/**
 * A group's two sides made one: the right side's tabs after the left's, in
 * their order, with the tab up on the side that had the keyboard still up.
 */
export function joinSides(state: WindowTabs, group: string): WindowTabs {
  const layout = groupLayoutOf(state, group);
  if (layout.sides.length < 2) {
    return state;
  }
  const joined = layout.sides.flatMap((side) =>
    side.tabs.map((tab) => {
      const { side: _side, ...rest } = tab;
      return rest;
    }),
  );
  const first = state.tabs.findIndex((tab) => tab.group === group);
  const others = state.tabs.filter((tab) => tab.group !== group);
  const before = state.tabs
    .slice(0, first)
    .filter((tab) => tab.group !== group).length;
  return normalizeSides(
    { ...state, tabs: others.toSpliced(before, 0, ...joined) },
    group,
  );
}

/** The side with the keyboard moved to a side of a group, its tab up there now up with it. */
export function focusSide(
  state: WindowTabs,
  group: string,
  side: 0 | 1,
): WindowTabs {
  const layout = groupLayoutOf(state, group);
  const up = layout.sides[side]?.up;
  return side === layout.focused || up === undefined
    ? state
    : selectTab(state, up);
}

/**
 * One tab up on its side without the keyboard leaving the side that has it:
 * what an agent shows, and a tab moved behind.
 */
export function raiseTab(state: WindowTabs, id: string): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (tab?.group === undefined) {
    return state;
  }
  const layout = groupLayoutOf(state, tab.group);
  const side = sideIndexOf(layout, id);
  if (side === undefined || side === layout.focused) {
    return selectTab(state, id);
  }
  return state.besideByGroup?.[tab.group] === id
    ? state
    : {
        ...state,
        besideByGroup: { ...state.besideByGroup, [tab.group]: id },
      };
}

/** A page tab of the window: a browser session of its own, in a group. */
export type PageTab = Extract<WindowTab, { kind: "page" }>;

/** A screen tab of the window: a route of its own, walked by a router of its own. */
export type ScreenTab = Extract<WindowTab, { kind: "screen" }>;

/** Where a screen tab's router has been, and where along it the tab stands. */
type ScreenHistory = NonNullable<ScreenTab["history"]>;

/** A group's tabs, in strip order. */
export function tabsIn(state: WindowTabs, group: string | undefined) {
  return group === undefined
    ? []
    : state.tabs.filter((tab) => tab.group === group);
}

/**
 * The tab a group has up on the side with the keyboard: what the window
 * shows of it first, and what its page and its chords act on.
 */
export function selectedTabIn(
  state: WindowTabs,
  group: string | undefined,
): undefined | WindowTab {
  if (group === undefined) {
    return undefined;
  }
  const layout = groupLayoutOf(state, group);
  const up = layout.sides[layout.focused]?.up;
  return state.tabs.find((tab) => tab.id === up);
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

/**
 * Whether a tab is a new tab nobody has written in: a new chat with no
 * draft yet. Such a tab is told where to go rather than kept beside what was
 * asked for.
 */
export function isHomeTab(tab: WindowTab): boolean {
  if (tab.kind !== "screen") {
    return false;
  }
  const screen = matchScreen(tab.href);
  return screen.kind === "inbox" && screen.draft === undefined;
}

/**
 * The blank new tab a group has up, which what is opened into the group
 * takes the place of. None where the group is a split: a tab on a side of
 * one keeps its place.
 */
export function blankUpIn(
  state: WindowTabs,
  group: string,
): undefined | WindowTab {
  const up = selectedTabIn(state, group);
  return up && isHomeTab(up) && !isSplit(groupLayoutOf(state, group))
    ? up
    : undefined;
}

/** Whether a group is laid out on two sides. */
export function isSplit(layout: GroupLayout): boolean {
  return layout.sides.length === 2;
}

/** Whether a tab is a new chat, written in or not: the zero state, at `/chats`. */
export function isNewChatTab(tab: WindowTab): boolean {
  return tab.kind === "screen" && matchScreen(tab.href).kind === "inbox";
}

/** The draft a new chat's tab writes into, once its address names one. */
export function draftOfTab(tab: WindowTab): string | undefined {
  if (tab.kind !== "screen") {
    return undefined;
  }
  const screen = matchScreen(tab.href);
  return screen.kind === "inbox" ? screen.draft : undefined;
}

/** The chat a tab stands on, for a chat's tab. */
export function chatOfTab(tab: WindowTab): ChatId | undefined {
  if (tab.kind !== "screen") {
    return undefined;
  }
  const screen = matchScreen(tab.href);
  return screen.kind === "chat" ? screen.chat : undefined;
}

/**
 * Whether a tab is a chat's. A chat's tab stays on its chat: what would go
 * there opens right after it.
 */
export function isChatTab(tab: WindowTab): boolean {
  return chatOfTab(tab) !== undefined;
}

/** The chat a group has up: on the side with the keyboard, else on the other. */
export function chatUpIn(state: WindowTabs, group: string): ChatId | undefined {
  const layout = groupLayoutOf(state, group);
  const ups = [layout.focused, layout.focused === 0 ? 1 : 0].map((at) =>
    state.tabs.find((tab) => tab.id === layout.sides[at]?.up),
  );
  for (const tab of ups) {
    const chat = tab === undefined ? undefined : chatOfTab(tab);
    if (chat !== undefined) {
      return chat;
    }
  }
  return undefined;
}

/**
 * A new tab that never went anywhere, which a reopen would give back as a new
 * one would: not worth keeping on the closed list.
 */
export function isBlankNewTab(tab: WindowTab): boolean {
  return (
    isHomeTab(tab) &&
    (tab.past?.length ?? 0) === 0 &&
    (tab.kind !== "screen" || (tab.history?.entries.length ?? 0) <= 1)
  );
}

/**
 * Whether an agent's close puts these tabs on the closed list, which
 * Shift+Cmd+T and History bring back what the person lost from: unless every
 * one is an agent's own scratch, a tab an agent opened (`openedBy`) whose page
 * the person has not pressed in (`personPressed`, by tab id). A group with any
 * tab of the person's goes on whole, so nothing of theirs is lost.
 */
export function agentCloseKeeps(
  tabs: readonly WindowTab[],
  personPressed: (id: string) => boolean,
): boolean {
  return tabs.some(
    (tab) =>
      tab.openedBy === undefined ||
      (tab.kind === "page" && personPressed(tab.id)),
  );
}

/**
 * The tab group's tab a closed entry of the window holds (`closeGroupTab`),
 * in a group; none for a closed tab of the window's own.
 */
export function closedGroupTabOf({
  groupTab,
}: {
  groupTab?: unknown;
}): (WindowTab & { group: string }) | undefined {
  return isGroupTabRecord(groupTab) ? groupTab : undefined;
}

/** The tabs of a whole group a closed entry holds (`closeTabGroup`); none for any other entry. */
export function closedTabGroupOf({
  groupTabs,
}: {
  groupTabs?: unknown;
}): (WindowTab & { group: string })[] | undefined {
  return Array.isArray(groupTabs) &&
    groupTabs.length > 0 &&
    groupTabs.every(isGroupTabRecord)
    ? groupTabs
    : undefined;
}

/** Every tab a closed entry brings back: a group's, a side's, or the lone tab; none for an entry holding no group's tabs. */
export function closedTabsOf(entry: {
  groupTab?: unknown;
  groupTabs?: unknown;
}): (WindowTab & { group: string })[] {
  const tab = closedGroupTabOf(entry);
  return closedTabGroupOf(entry) ?? (tab ? [tab] : []);
}

/**
 * One side of a group a closed entry holds (`closeGroupSide`): its group,
 * which side it was, its tabs, the place among them of the one it had up,
 * and whether it had the keyboard; none for any other entry.
 */
export function closedSideOf(entry: {
  focused?: boolean;
  groupTabs?: unknown;
  index?: number;
  side?: 0 | 1;
}):
  | undefined
  | {
      focused: boolean;
      group: string;
      side: 0 | 1;
      tabs: WindowTab[];
      up: number;
    } {
  const tabs = closedTabGroupOf(entry);
  const [first] = tabs ?? [];
  return entry.side === undefined || !tabs || !first
    ? undefined
    : {
        focused: entry.focused ?? true,
        group: first.group,
        side: entry.side,
        tabs,
        up: entry.index ?? 0,
      };
}

/**
 * How a closed entry's tabs stood: a whole group's sides as a reopen lays
 * them out again (`restoreGroup`), each with the tab it had up; one side of
 * a group alone, with its own; or a lone tab. None for an entry holding no
 * group's tabs.
 */
export function closedSidesOf(entry: {
  focused?: boolean;
  groupTab?: unknown;
  groupTabs?: unknown;
  index?: number;
  side?: 0 | 1;
  ups?: { active: number; beside?: number };
}): GroupSide[] | undefined {
  const side = closedSideOf(entry);
  if (side) {
    return [{ tabs: side.tabs, up: side.tabs[side.up]?.id }];
  }
  const tabs = closedTabGroupOf(entry);
  const [first] = tabs ?? [];
  if (tabs && first) {
    const state = restoreGroup(
      { activeByGroup: {}, tabs: [] },
      first.group,
      tabs,
      entry.ups,
    );
    return groupLayoutOf(state, first.group).sides;
  }
  const tab = closedGroupTabOf(entry);
  return tab ? [{ tabs: [tab], up: tab.id }] : undefined;
}

/**
 * Where among a closing group's kept tabs the ones it has up stand: the one
 * on the side with the keyboard, and the one on the other side, for a reopen
 * to put them up again. None when the tab with the keyboard is not kept.
 */
export function upsAmong(
  layout: GroupLayout,
  kept: readonly WindowTab[],
): undefined | { active: number; beside?: number } {
  const placeOf = (side: number) => {
    const id = layout.sides[side]?.up;
    const at = kept.findIndex((tab) => tab.id === id);
    return at === -1 ? undefined : at;
  };
  const active = placeOf(layout.focused);
  const beside = placeOf(layout.focused === 0 ? 1 : 0);
  return active === undefined
    ? undefined
    : beside === undefined
      ? { active }
      : { active, beside };
}

/** Whether a kept value is a tab of a group, as `closeGroupTab` alone writes one. */
function isGroupTabRecord(
  value: unknown,
): value is WindowTab & { group: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "group" in value &&
    typeof value.group === "string" &&
    "kind" in value &&
    (value.kind === "page" || value.kind === "screen")
  );
}

/**
 * One tab of its group up, with the keyboard: on the side with it already,
 * or on the other side, which takes the keyboard while the side it leaves
 * keeps its tab up. A tab in no group has nothing to be up in.
 */
export function selectTab(state: WindowTabs, id: string): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || tab.group === undefined) {
    return state;
  }
  const { group } = tab;
  const layout = groupLayoutOf(state, group);
  const side = sideIndexOf(layout, id);
  if (layout.sides.length < 2 || side === layout.focused) {
    return pointAt(state, group, id);
  }
  const leaving = layout.sides[layout.focused]?.up;
  const pointed = pointAt(state, group, id);
  return leaving === undefined
    ? pointed
    : {
        ...pointed,
        besideByGroup: { ...state.besideByGroup, [group]: leaving },
      };
}

/** The tabs a group has up: on the side with the keyboard, and on the other. */
interface UpTabs {
  active: string | undefined;
  beside: string | undefined;
}

export function upTabsIn(state: WindowTabs, group: string): UpTabs {
  return {
    active: state.activeByGroup[group],
    beside: state.besideByGroup?.[group],
  };
}

/**
 * A group's tabs up again as they were, the keyboard on the side it was on,
 * for something taken back, such as a canceled drag. A tab closed since is
 * left closed, and with the tab that had the keyboard gone nothing changes.
 */
export function putUpBack(
  state: WindowTabs,
  group: string,
  { active, beside }: UpTabs,
): WindowTabs {
  const isIn = (id: string) =>
    state.tabs.some((tab) => tab.id === id && tab.group === group);
  const now = upTabsIn(state, group);
  if (
    active === undefined ||
    !isIn(active) ||
    (now.active === active && now.beside === beside)
  ) {
    return state;
  }
  const { [group]: _beside, ...otherBesides } = state.besideByGroup ?? {};
  return {
    ...state,
    activeByGroup: { ...state.activeByGroup, [group]: active },
    besideByGroup:
      beside !== undefined && isIn(beside)
        ? { ...otherBesides, [group]: beside }
        : otherBesides,
  };
}

/**
 * A screen tab at an address, at the end of a group's tabs or right after
 * the tab named, and up in it when asked.
 */
export function addScreen(
  state: WindowTabs,
  {
    after,
    group,
    from,
    href,
    id,
    select,
    side,
  }: {
    /** The tab it opens beside, as a link opened in a new tab lands beside the page it was in. */
    after?: string;
    group: string;
    from?: Opening;
    href: string;
    id: string;
    select: boolean;
    side?: Placing["side"];
  },
): WindowTabs {
  const tab: WindowTab = { group, href, id, kind: "screen" };
  return openInGroup(state, tab, {
    ...(after === undefined ? {} : { after }),
    ...(from === undefined ? {} : { from }),
    group,
    select,
    ...(side === undefined ? {} : { side }),
  });
}

/** The tabs with one more, right after the tab named, or at the end where none is. */
function insertAfter(
  tabs: WindowTab[],
  tab: WindowTab,
  after: string | undefined,
): WindowTab[] {
  const at = tabs.findIndex((entry) => entry.id === after);
  return at === -1
    ? [...tabs, tab]
    : [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)];
}

/**
 * The tab of a group showing what an address shows: a screen tab at it, or
 * at the same file, folder or task however far it has walked within it
 * (`showsSame`), or the page a file's tab became, which is still the file's
 * tab. The one the group has up comes first.
 */
export function tabShowingIn(
  state: WindowTabs,
  group: string,
  href: string,
): undefined | WindowTab {
  const filePath = computerTabOf(href)?.file;
  const shows = (tab: WindowTab) =>
    tab.group === group &&
    (tab.kind === "screen"
      ? showsSame(tab.href, href)
      : filePath !== undefined && hostPathOfFileUrl(tab.url) === filePath);
  const up = selectedTabIn(state, group);
  return up && shows(up) ? up : state.tabs.find(shows);
}

/**
 * The tab showing exactly what an address shows (`showsSameThing`: the same
 * file, Files folder, chat, task, app or Settings, never a folder for a file
 * in it) in any of some groups, a file's page counting as the file: what
 * something handed over from outside brings up rather than opening again.
 * The group on screen is looked in first, then the rest in the order given,
 * and in each the tab it has up first.
 */
export function tabShowingAmong(
  state: WindowTabs,
  groups: readonly string[],
  href: string,
  onScreen?: string,
): undefined | WindowTab {
  const filePath = computerTabOf(href)?.file;
  const shows = (tab: WindowTab) =>
    tab.kind === "screen"
      ? showsSameThing(tab.href, href)
      : filePath !== undefined && hostPathOfFileUrl(tab.url) === filePath;
  const ordered =
    onScreen !== undefined && groups.includes(onScreen)
      ? [onScreen, ...groups.filter((group) => group !== onScreen)]
      : groups;
  for (const group of ordered) {
    const up = selectedTabIn(state, group);
    if (up && shows(up)) {
      return up;
    }
    const tab = state.tabs.find((each) => each.group === group && shows(each));
    if (tab) {
      return tab;
    }
  }
  return undefined;
}

/**
 * The tab already showing an address in a group (`tabShowingIn`), or one
 * opened there. A file is not opened twice. A group waiting behind with
 * its new tab up is told where to go, the way the tab on screen is: the
 * screen lands in that tab rather than beside it, and the tab keeps its id,
 * so what remembered it still finds it.
 */
export function openOrFocusScreen(
  state: WindowTabs,
  {
    after,
    group,
    from,
    href,
    id,
    isWaiting,
    select,
  }: {
    /** The tab a new one opens right after, on that tab's side. */
    after?: string;
    group: string;
    href: string;
    /** The id a new tab takes. */
    id: string;
    from?: Opening;
    /** Whether the group is waiting behind rather than on screen. */
    isWaiting: boolean;
    select: boolean;
  },
): { id: string; state: WindowTabs } {
  const existing = tabShowingIn(state, group, href);
  if (existing) {
    return {
      id: existing.id,
      state: select ? selectTab(state, existing.id) : state,
    };
  }
  const up = isWaiting ? blankUpIn(state, group) : undefined;
  if (up) {
    const told = mapTab(state, up.id, (tab) => {
      if (tab.kind !== "screen") {
        return tab;
      }
      const { history: _left, ...rest } = tab;
      return { ...rest, future: [], href };
    });
    return { id: up.id, state: select ? selectTab(told, up.id) : told };
  }
  return {
    id,
    state: addScreen(state, {
      ...(after === undefined ? {} : { after }),
      group,
      ...(from === undefined ? {} : { from }),
      href,
      id,
      select,
    }),
  };
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
 * A file tab going to another file at `href`, as its viewer shows a file its
 * page went to: in the current entry's place when the page's own history
 * holds the step (another page's file), as a step of the tab's own otherwise.
 */
export function fileTabWalked(
  state: WindowTabs,
  id: string,
  href: string,
  { replace }: { replace: boolean },
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (tab?.kind !== "screen") {
    return state;
  }
  const { entries, index } = historyOf(tab);
  return screenMoved(state, id, {
    history: replace
      ? { entries: entries.with(index, href), index }
      : { entries: [...entries.slice(0, index + 1), href], index: index + 1 },
    href,
  });
}

/**
 * A group's tab up goes to a screen: a screen tab walks there, and a page
 * becomes the screen, with the page a step back.
 */
export function navigateScreen(
  state: WindowTabs,
  { group, href, id }: { group: string; href: string; id: string },
): WindowTabs {
  const up = selectedTabIn(state, group);
  return up ? tabToScreen(state, { href, id: up.id, newId: id }) : state;
}

/**
 * A tab goes to a screen: a screen tab walks there, a chat's included, and a
 * page becomes the screen, as a tab of its own (`newId`) with the page a
 * step back. What a chat's own contents open goes beside it instead
 * (`besidePlacementOf`), never through here.
 */
export function tabToScreen(
  state: WindowTabs,
  { href, id, newId }: { href: string; id: string; newId: string },
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  return tab?.kind === "page"
    ? replaceTab(
        state,
        id,
        visitInTab(tab, { href, id: newId, kind: "screen" }),
      )
    : visitScreen(state, id, href);
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
  const tab = {
    ...next,
    group: next.group ?? replaced.group,
    ...(replaced.side === undefined ? {} : { side: replaced.side }),
  };
  const group = tab.group;
  return {
    ...state,
    activeByGroup:
      group !== undefined && state.activeByGroup[group] === id
        ? { ...state.activeByGroup, [group]: tab.id }
        : state.activeByGroup,
    besideByGroup:
      group !== undefined && state.besideByGroup?.[group] === id
        ? { ...state.besideByGroup, [group]: tab.id }
        : (state.besideByGroup ?? {}),
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
 * A tab closed. The tab up on its side gives way to the next one
 * (`nextUpAfter`), or to `up` where a step back named it; a side's last tab closing leaves the other side as the
 * whole group, with the keyboard. A group's last tab closes like any other,
 * leaving the group with none.
 */
export function closeTab(
  state: WindowTabs,
  id: string,
  { up }: { up?: string } = {},
): WindowTabs {
  const group = state.tabs.find((tab) => tab.id === id)?.group;
  const out = takeOut(state, id);
  const closed = group === undefined ? out : normalizeSides(out, group);
  return up === undefined ? closed : selectTab(closed, up);
}

/**
 * A page whose first navigation became a download, so it has nothing to
 * show, handled as Chromium's `DownloadUIController` handles one. A tab that
 * showed something before goes back to it, and the page leaves its history.
 * One that showed nothing else closes when its group has another tab, and a
 * group's only tab stays. The close is not the person's, so it puts nothing
 * on the closed list.
 */
export function pageBecameDownload(state: WindowTabs, id: string): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (tab?.kind !== "page") {
    return state;
  }
  if (tab.past?.length) {
    const back = stepTabVisit(tab, -1);
    return back
      ? replaceTab(state, id, { ...back, future: tab.future })
      : state;
  }
  const strip = state.tabs.filter((entry) => entry.group === tab.group);
  return strip.length > 1 ? closeTab(state, id) : state;
}

/** A group gone with everything in it, what it keeps of its own with it. */
export function dropGroup(state: WindowTabs, group: string): WindowTabs {
  if (
    !(group in state.activeByGroup) &&
    !(group in (state.groups ?? {})) &&
    !state.tabs.some((tab) => tab.group === group)
  ) {
    return state;
  }
  const { [group]: _dropped, ...activeByGroup } = state.activeByGroup;
  const { [group]: _beside, ...besideByGroup } = state.besideByGroup ?? {};
  const { [group]: _own, ...groups } = state.groups ?? {};
  return {
    ...state,
    activeByGroup,
    besideByGroup,
    groups,
    tabs: state.tabs.filter((tab) => tab.group !== group),
  };
}

/** A tab marked as opened by a chat's agent, unless one is marked already. */
export function markOpenedBy(
  state: WindowTabs,
  id: string,
  chat: ChatId,
): WindowTabs {
  // A file tab's page, the id agents name the file tab by, marks the file tab.
  const group = state.tabs.find((tab) => tab.id === id)?.group;
  const target = group?.startsWith(HOSTED_PAGE_GROUP_PREFIX)
    ? group.slice(HOSTED_PAGE_GROUP_PREFIX.length)
    : id;
  return state.tabs.some(
    (tab) => tab.id === target && tab.openedBy === undefined,
  )
    ? mapTab(state, target, (tab) => ({ ...tab, openedBy: chat }))
    : state;
}

/**
 * A tab marked as the page an app's sign-in on its own site waits on, or
 * with that mark taken off. One page per app: any other tab marked for the
 * same app loses its mark.
 */
export function markSignIn(
  state: WindowTabs,
  id: string,
  signIn: WindowTab["signIn"],
): WindowTabs {
  if (!state.tabs.some((tab) => tab.id === id)) {
    return state;
  }
  return {
    ...state,
    tabs: state.tabs.map((tab) => {
      if (tab.id !== id && tab.signIn?.slug !== signIn?.slug) {
        return tab;
      }
      const { signIn: _was, ...rest } = tab;
      return tab.id === id && signIn !== undefined ? { ...rest, signIn } : rest;
    }),
  };
}

/** A tab marked as the one its chat was last sent a message from (`workingTabOf`). */
export function markPrompted(
  state: WindowTabs,
  id: string,
  at: number,
): WindowTabs {
  return state.tabs.some((tab) => tab.id === id)
    ? mapTab(state, id, (tab) => ({ ...tab, promptedAt: at }))
    : state;
}

/**
 * A tab into another group, at the end of the side with the keyboard there:
 * a page drawn inside a tab becoming a site of the window's own, or a tab
 * dragged to another tab group. The group it leaves keeps nothing of it, and
 * the side it left gives way as on a close.
 */
export function moveToGroup(
  state: WindowTabs,
  id: string,
  group: string,
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab || tab.group === group) {
    return state;
  }
  return moveTabTo(state, {
    group,
    id,
    side: groupLayoutOf(state, group).focused,
  });
}

/**
 * Some of a group's tabs in a new order, by their strip keys, in the places
 * they had between them: a side's strip reordered. Nothing moves unless every
 * key names one of the group's tabs, once.
 */
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
  const named = new Set(ordered);
  if (ordered.length !== keys.length || named.size !== keys.length) {
    return state;
  }
  let next = 0;
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      named.has(tab) ? (ordered[next++] ?? tab) : tab,
    ),
  };
}

/**
 * A page drawn inside another tab (a page's file drawn in a file tab's viewer) taking
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
 * A page tab that went to a page's file on the computer becoming that file's
 * tab, the inverse of {@link pageTakesOver}: a file tab stands where the page
 * stood, in its place in the strip and its group, and the page, guest and
 * all, goes on as the page that tab draws, in `hostGroup`. What the page
 * showed before the file (`left`) is a step back in the tab's own history,
 * under an id of its own, as the file is behind a page that left it; the
 * guest's own history goes with neither.
 */
export function pageBecomesFile(
  state: WindowTabs,
  {
    file,
    hostGroup,
    left,
    page: pageId,
  }: {
    file: { href: string; id: string };
    hostGroup: string;
    left?: { id: string; title?: string; url: string };
    page: string;
  },
): WindowTabs {
  const page = state.tabs.find((entry) => entry.id === pageId);
  if (page?.kind !== "page" || page.group === undefined) {
    return state;
  }
  const { future: _future, past, stripKey, ...hosted } = page;
  const { group: _group, ...visit } = hosted;
  const behind = [
    ...(past ?? []),
    ...(left === undefined
      ? []
      : [
          {
            ...omit(visit, ["favicon", "title"]),
            id: left.id,
            url: left.url,
            ...(left.title === undefined ? {} : { title: left.title }),
          },
        ]),
  ];
  const replaced = replaceTab(state, pageId, {
    group: page.group,
    href: file.href,
    id: file.id,
    kind: "screen",
    ...(behind.length === 0 ? {} : { past: behind }),
    stripKey: stripKey ?? page.id,
  });
  return {
    ...replaced,
    tabs: [...replaced.tabs, { ...hosted, group: hostGroup }],
  };
}

/**
 * A new page tab. In a tab's place, it takes that tab's place in the strip
 * and under its strip key, so the strip sees one tab changing rather than one
 * leaving and another arriving, and it is what that group has up; back from
 * it returns to that tab, a chat's included. Otherwise it joins the group at the end, or right after the
 * tab named, up when asked, with nothing behind it, as a browser's tab
 * opened from a link starts.
 */
export function openPage(
  state: WindowTabs,
  {
    after,
    from,
    group,
    page,
    replacing,
    select,
    side,
  }: {
    /** The tab it opens beside rather than at the group's end. */
    after?: string;
    from?: Opening;
    group: string | undefined;
    page: BrowserTab;
    replacing?: WindowTab;
    select: boolean;
    side?: Placing["side"];
  },
): WindowTabs {
  if (replacing) {
    const tab = visitInTab(replacing, { ...page, kind: "page" });
    // In its place, up where it was up on either side.
    const replaced = state.tabs.some((entry) => entry.id === replacing.id)
      ? replaceTab(state, replacing.id, tab)
      : { ...state, tabs: [...state.tabs, tab] };
    // Up in its group, with the keyboard on its side, which is where the
    // tab it replaced was asked to go somewhere.
    return replacing.group === undefined
      ? replaced
      : selectTab(replaced, page.id);
  }
  const tab: WindowTab = { ...page, group, kind: "page" };
  if (group === undefined) {
    return { ...state, tabs: insertAfter(state.tabs, tab, after) };
  }
  return openInGroup(state, tab, {
    ...(after === undefined ? {} : { after }),
    ...(from === undefined ? {} : { from }),
    group,
    select,
    ...(side === undefined ? {} : { side }),
  });
}

/**
 * Page tabs a group gains behind whatever it has up: a task's guests
 * arriving, a page opened for an agent's own work. Each goes right after the
 * tab named, on its side, when one is (the chat's tab whose agent opened
 * it), or at the end of the side with the keyboard.
 */
export function addPages(
  state: WindowTabs,
  pages: (BrowserTab &
    Pick<WindowTab, "openedBy"> & { group: string | undefined })[],
  { after, from }: { after?: string; from?: Opening } = {},
): WindowTabs {
  let next = state;
  for (const page of pages) {
    const tab: WindowTab = { ...page, kind: "page" };
    next =
      page.group === undefined
        ? { ...next, tabs: [...next.tabs, tab] }
        : openInGroup(next, tab, {
            ...(after === undefined ? {} : { after }),
            ...(from === undefined ? {} : { from }),
            group: page.group,
          });
  }
  return next;
}

/** What a page tab knows of its page, as the page announces it; nothing changes when nothing differs. */
/**
 * The title a page tab keeps as its guest commits an address. The browser
 * names a new document by its address until the page's own title arrives,
 * so a tab gone to another address keeps no title until the page announces
 * one (`page-title-updated`) or finishes loading without one. A tab still on
 * its document, or reloading the same address, keeps the guest's title.
 */
export function titleAtNavigation({
  guestTitle,
  isNewDocument,
  url,
  was,
}: {
  guestTitle: string;
  isNewDocument: boolean;
  url: string;
  was: string | undefined;
}): string | undefined {
  return isNewDocument && url !== was ? undefined : guestTitle || undefined;
}

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
 * A group's tabs put back, as a site's after its window tab was reopened or
 * a closed group's: they take the group's place, with the tabs `ups` names
 * by their places among them up as they were (the keyboard on `active`'s
 * side), else the first of them up.
 */
export function restoreGroup(
  state: WindowTabs,
  group: string,
  tabs: WindowTab[],
  ups?: { active: number; beside?: number },
): WindowTabs {
  const restored = {
    ...state,
    tabs: [...state.tabs.filter((tab) => tab.group !== group), ...tabs],
  };
  const active = tabs[ups?.active ?? 0] ?? tabs[0];
  if (!active) {
    return restored;
  }
  const pointed = pointAt(restored, group, active.id);
  const beside = ups?.beside === undefined ? undefined : tabs[ups.beside];
  return beside
    ? {
        ...pointed,
        besideByGroup: { ...state.besideByGroup, [group]: beside.id },
      }
    : pointed;
}

/**
 * A closed tab back in its group, on the side it had, at the place it had
 * among that side's tabs (as near as the tabs left allow), and up in it
 * with the keyboard. A tab of a side since gone makes that side again.
 */
export function reopenTab(
  state: WindowTabs,
  { index, tab }: { index: number; tab: WindowTab },
): WindowTabs {
  const { group } = tab;
  if (group === undefined) {
    return state;
  }
  const layout = groupLayoutOf(state, group);
  const side = layout.sides.length === 1 && sideOf(tab) === 0 ? 0 : sideOf(tab);
  const sideTabs = state.tabs.filter(
    (entry) => entry.group === group && sideOf(entry) === side,
  );
  const tabs = spliceIn(state.tabs, tab, {
    index: Math.min(index, sideTabs.length),
    side,
  });
  return selectTab(normalizeSides({ ...state, tabs }, group), tab.id);
}

/**
 * One side of a group of two closed whole, every tab on it, which leaves the
 * other side as the whole group, with the keyboard. A group of one side has
 * no side to close apart from the group.
 */
export function closeSide(
  state: WindowTabs,
  group: string,
  side: 0 | 1,
): WindowTabs {
  const layout = groupLayoutOf(state, group);
  if (layout.sides.length < 2) {
    return state;
  }
  return (layout.sides[side]?.tabs ?? []).reduce(
    (current, tab) => closeTab(current, tab.id),
    state,
  );
}

/**
 * A closed side back in its group as the side it was, its tabs in their
 * order, the one it had up (`up`, by its place among them) up there with
 * the keyboard when it had it on closing (`focused`), else with the keyboard
 * left on the other side. A left side coming back moves a group of one side
 * over to the right; with two sides there already, the tabs join the side
 * they had.
 */
export function reopenSide(
  state: WindowTabs,
  {
    focused = true,
    group,
    side,
    tabs,
    up = 0,
  }: {
    focused?: boolean;
    group: string;
    side: 0 | 1;
    tabs: WindowTab[];
    up?: number;
  },
): WindowTabs {
  const layout = groupLayoutOf(state, group);
  // The tab up with the keyboard now, which keeps it when the side coming
  // back did not have it.
  const stayed = layout.sides[layout.focused]?.up;
  const isOneSide = layout.sides.length < 2;
  const moved =
    isOneSide && side === 0
      ? state.tabs.map((tab) =>
          tab.group === group ? { ...tab, side: 1 as const } : tab,
        )
      : state.tabs;
  const placed = tabs.map(({ side: _side, ...tab }) =>
    side === 1 ? { ...tab, group, side: 1 as const } : { ...tab, group },
  );
  const last = moved.findLastIndex((tab) => tab.group === group);
  const next = {
    ...state,
    tabs:
      last === -1
        ? [...moved, ...placed]
        : moved.toSpliced(last + 1, 0, ...placed),
  };
  const shown = placed[up] ?? placed[0];
  const normal = normalizeSides(next, group);
  const raised = shown ? selectTab(normal, shown.id) : normal;
  return !focused && stayed !== undefined && stayed !== shown?.id
    ? selectTab(raised, stayed)
    : raised;
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
