import {
  type BrowserTab,
  NEW_TAB_HREF,
  newTabHrefOf,
  type TabVisit,
  type WindowTab,
} from "@/client/atoms/window";
import { movedTabHistory } from "@/shared/tabs";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { type ChatId, StoreId } from "@instrument-org/workspace/client";

import { computerTabOf } from "./file-tabs";
import { groupScreenTabsOnly } from "./group-screen";
import { historyOf, stepTabVisit, visitInTab } from "./tab-history";
import { matchScreen, sameHref, showsSame } from "./window-href";

/**
 * What the window has open: every group's tabs in strip order, each on one
 * of its group's one or two sides, and the tab up on each side. A group is
 * keyed by an id of its own, opaque here: a new group's, or a chat's id or a
 * draft's key an earlier build kept its tabs under. Which group is on screen
 * is not kept here, since it is whatever the window's tab up stands on.
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
  tabs: WindowTab[];
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

/**
 * The tab up on the other side from a tab, in a group of two sides: what a
 * chat's next message carries, beside it. None in a group of one side.
 */
export function besideOf(
  state: WindowTabs,
  id: string,
): undefined | WindowTab {
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
export function normalizeSides(state: WindowTabs, group: string): WindowTabs {
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

/** Every group's sides normalized, for tabs as kept. */
function normalizeAllSides(state: WindowTabs): WindowTabs {
  const groups = new Set(
    state.tabs.flatMap((tab) => (tab.group === undefined ? [] : [tab.group])),
  );
  let next = state;
  for (const group of groups) {
    next = normalizeSides(next, group);
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
  const afterSide = after === undefined ? undefined : sideIndexOf(layout, after);
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
  { select = false, ...placing }: Placing & { select?: boolean },
): WindowTabs {
  const added = normalizeSides(
    insertInGroup(state, tab, placing),
    placing.group,
  );
  return select ? selectTab(added, tab.id) : added;
}

/**
 * A tab taken out of its group's list as it closes or moves: the side it
 * leaves has the tab before it up, or the one after, where it was up; a side
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
  const layout = groupLayoutOf(state, group);
  const at = sideIndexOf(layout, id) ?? 0;
  const side = layout.sides[at];
  if (side?.up !== id) {
    return { ...state, tabs: remaining };
  }
  const index = side.tabs.findIndex((tab) => tab.id === id);
  const next = side.tabs[index - 1] ?? side.tabs[index + 1];
  const { [group]: _active, ...activeByGroup } = state.activeByGroup;
  const { [group]: _beside, ...besideByGroup } = state.besideByGroup ?? {};
  const other = layout.sides[at === 0 ? 1 : 0]?.up;
  if (at === layout.focused) {
    const active = next?.id ?? other;
    return {
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
    activeByGroup: state.activeByGroup,
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
 * 1 of a group of one side is a second side made for it. Up and with the
 * keyboard when asked.
 */
export function moveTabTo(
  state: WindowTabs,
  {
    group,
    id,
    index,
    select = false,
    side,
  }: { group: string; id: string; index?: number; select?: boolean; side: 0 | 1 },
): WindowTabs {
  const tab = state.tabs.find((entry) => entry.id === id);
  if (!tab) {
    return state;
  }
  const from = tab.group;
  // The side is read from the layout before the tab leaves it, so moving a
  // left side's last tab to the right makes one side, not two.
  const target = groupLayoutOf(state, group);
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
    group,
    ...(kept === 1 ? { side: 1 as const } : {}),
  };
  let next: WindowTabs = {
    ...out,
    tabs: spliceIn(out.tabs, placed, { index, side: kept }),
  };
  next = normalizeSides(next, group);
  if (from !== undefined && from !== group) {
    next = normalizeSides(next, from);
  }
  return select ? selectTab(next, id) : next;
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
  const idOf = tabIdsOfEarlierBuilds();
  const activeByGroup = Object.fromEntries(
    Object.entries(stored.activeByGroup ?? {}).map(([group, id]) => [
      group,
      idOf(id),
    ]),
  );
  if (stored.group !== undefined && stored.activeId) {
    activeByGroup[stored.group] = idOf(stored.activeId);
  }
  const tabs = (stored.tabs ?? []).map((kept): WindowTab => {
    const tab = {
      ...kept,
      id: idOf(kept.id),
      ...(kept.stripKey === undefined ? {} : { stripKey: idOf(kept.stripKey) }),
      ...(kept.past === undefined
        ? {}
        : {
            past: kept.past.map((visit) => ({ ...visit, id: idOf(visit.id) })),
          }),
      ...(kept.future === undefined
        ? {}
        : {
            future: kept.future.map((visit) => ({
              ...visit,
              id: idOf(visit.id),
            })),
          }),
    };
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
  const besideByGroup = Object.fromEntries(
    Object.entries(stored.besideByGroup ?? {}).map(([group, id]) => [
      group,
      idOf(id),
    ]),
  );
  return normalizeAllSides({
    activeByGroup,
    besideByGroup,
    tabs: groupScreenTabsOnly(tabs),
  });
}

/**
 * A tab's id as this build mints them, from one an earlier build kept: a
 * page's `ses_` id keeps its ULID under `tab_`, and a screen's `screen-` id
 * gets a fresh one, the same for every place the kept tabs name it.
 */
function tabIdsOfEarlierBuilds() {
  const fresh = new Map<string, string>();
  return (id: string): string => {
    if (StoreId.SessionSchema.safeParse(id).success) {
      return `tab_${id.slice("ses_".length)}`;
    }
    if (!id.startsWith("screen-")) {
      return id;
    }
    const known = fresh.get(id);
    if (known !== undefined) {
      return known;
    }
    const minted = StoreId.newTabId();
    fresh.set(id, minted);
    return minted;
  };
}

/**
 * Every screen tab's address, its history and the screens it went to and
 * from at the address `move` gives each, the way a folder they stand in
 * moving takes them: the same state when nothing moved.
 */
export function tabsAfterMove(
  state: WindowTabs,
  move: (href: string) => string,
): WindowTabs {
  const visitMoved = <T extends TabVisit>(visit: T): T => {
    if (visit.kind !== "screen") {
      return visit;
    }
    const href = move(visit.href);
    const history = movedTabHistory(visit.history, move);
    return href === visit.href && history === visit.history
      ? visit
      : { ...visit, href, ...(history === undefined ? {} : { history }) };
  };
  const visitsMoved = (visits: TabVisit[] | undefined) => {
    const moved = visits?.map(visitMoved);
    return moved?.every((visit, at) => visit === visits?.[at]) ? visits : moved;
  };
  let isMoved = false;
  const tabs = state.tabs.map((tab) => {
    const past = visitsMoved(tab.past);
    const future = visitsMoved(tab.future);
    const here = visitMoved(tab);
    if (here === tab && past === tab.past && future === tab.future) {
      return tab;
    }
    isMoved = true;
    return {
      ...here,
      ...(past === undefined ? {} : { past }),
      ...(future === undefined ? {} : { future }),
    };
  });
  return isMoved ? { ...state, tabs } : state;
}

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
 * draft yet, or an earlier build's new-tab page. Such a tab is told where to
 * go rather than kept beside what was asked for.
 */
export function isHomeTab(tab: WindowTab): boolean {
  if (tab.kind !== "screen") {
    return false;
  }
  const screen = matchScreen(tab.href);
  return (
    screen.kind === "newTab" ||
    (screen.kind === "inbox" && screen.draft === undefined)
  );
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

/** The chats a group has a tab on, in the order its row reads them: the left side first, then strip order. */
export function chatsOfGroup(state: WindowTabs, group: string): ChatId[] {
  const layout = groupLayoutOf(state, group);
  return layout.sides.flatMap((side) =>
    side.tabs.flatMap((tab) => {
      const chat = chatOfTab(tab);
      return chat === undefined ? [] : [chat];
    }),
  );
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

/** A chat's tab, the first one: in the groups named, in their order, or in any group. */
export function chatTabOf(
  state: WindowTabs,
  chat: ChatId,
  among?: readonly string[],
): undefined | WindowTab {
  const shows = (tab: WindowTab) => chatOfTab(tab) === chat;
  if (among === undefined) {
    return state.tabs.find((tab) => tab.group !== undefined && shows(tab));
  }
  for (const group of among) {
    const found = state.tabs.find((tab) => tab.group === group && shows(tab));
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Where something opened for a chat goes: the group with the chat's tab
 * (the group named first, when it has one) and right after that tab.
 * Undefined while no group has a tab on the chat.
 */
export function chatPlaceOf(
  state: WindowTabs,
  chat: ChatId,
  first?: string,
): undefined | { after: string; group: string } {
  const tab =
    (first === undefined ? undefined : chatTabOf(state, chat, [first])) ??
    chatTabOf(state, chat);
  return tab?.group === undefined
    ? undefined
    : { after: tab.id, group: tab.group };
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

/**
 * A screen tab at an address, at the end of a group's tabs or right after
 * the tab named, and up in it when asked.
 */
export function addScreen(
  state: WindowTabs,
  {
    after,
    group,
    href,
    id,
    isOpened = false,
    select,
    side,
  }: {
    /** The tab it opens beside, as a link opened in a new tab lands beside the page it was in. */
    after?: string;
    group: string;
    href: string;
    id: string;
    isOpened?: boolean;
    select: boolean;
    side?: Placing["side"];
  },
): WindowTabs {
  const tab: WindowTab = { group, href, id, isOpened, kind: "screen" };
  return openInGroup(state, tab, {
    ...(after === undefined ? {} : { after }),
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
    href,
    id,
    isOpened = false,
    isWaiting,
    select,
  }: {
    /** The tab a new one opens right after, on that tab's side. */
    after?: string;
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
  const existing = tabShowingIn(state, group, href);
  if (existing) {
    return {
      id: existing.id,
      state: select ? selectTab(state, existing.id) : state,
    };
  }
  const up = isWaiting ? selectedTabIn(state, group) : undefined;
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
  return {
    id,
    state: addScreen(state, {
      ...(after === undefined ? {} : { after }),
      group,
      href,
      id,
      isOpened,
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
 * A tab goes to a screen: a screen tab walks there, and a page becomes the
 * screen, as a tab of its own (`newId`) with the page a step back.
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
 * A tab closed. The tab up on its side gives way to the one before it, or
 * the one after; a side's last tab closing leaves the other side as the
 * whole group, with the keyboard. A group's last tab closes like any other,
 * leaving the group with none.
 */
export function closeTab(state: WindowTabs, id: string): WindowTabs {
  const group = state.tabs.find((tab) => tab.id === id)?.group;
  const out = takeOut(state, id);
  return group === undefined ? out : normalizeSides(out, group);
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
  const { [group]: _beside, ...besideByGroup } = state.besideByGroup ?? {};
  return {
    activeByGroup,
    besideByGroup,
    tabs: state.tabs.filter((tab) => tab.group !== group),
  };
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
 * it joins the group at the end, or right after the tab named, with a new
 * tab behind it, up when asked.
 */
export function openPage(
  state: WindowTabs,
  {
    after,
    group,
    homeId,
    page,
    replacing,
    select,
    side,
  }: {
    /** The tab it opens beside rather than at the group's end. */
    after?: string;
    group: string | undefined;
    /** The id of the new tab a page opened on its own has behind it. */
    homeId: string;
    page: BrowserTab;
    replacing?: WindowTab;
    select: boolean;
    side?: Placing["side"];
  },
): WindowTabs {
  if (replacing) {
    const tab = visitInTab(replacing, { ...page, kind: "page" });
    const index = state.tabs.findIndex((entry) => entry.id === replacing.id);
    const tabs =
      index === -1
        ? [...state.tabs, tab]
        : state.tabs.map((entry, at) => (at === index ? tab : entry));
    // Up in its group, with the keyboard on its side, which is where the
    // tab it replaced was asked to go somewhere.
    return replacing.group === undefined
      ? { ...state, tabs }
      : selectTab({ ...state, tabs }, page.id);
  }
  const tab: WindowTab = {
    ...page,
    group,
    kind: "page",
    past: [{ href: NEW_TAB_HREF, id: homeId, kind: "screen" }],
  };
  if (group === undefined) {
    return { ...state, tabs: insertAfter(state.tabs, tab, after) };
  }
  return openInGroup(state, tab, {
    ...(after === undefined ? {} : { after }),
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
  pages: (BrowserTab & { group: string | undefined })[],
  { after }: { after?: string } = {},
): WindowTabs {
  let next = state;
  for (const page of pages) {
    const tab: WindowTab = { ...page, kind: "page" };
    next =
      page.group === undefined
        ? { ...next, tabs: [...next.tabs, tab] }
        : openInGroup(next, tab, {
            ...(after === undefined ? {} : { after }),
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
