import { sidebarProjectAtom } from "@/client/atoms/tab-groups";
import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/window";
import { draftsAtom, draftsLoadedAtom } from "@/client/drafts/store";
import { keptInOtherWindows } from "@/client/lib/kept-state";
import { leaveField } from "@/client/lib/keyboard-home";
import { freshTabId } from "@/client/lib/tab-actions";
import { getTabRouter } from "@/client/lib/tab-router-registry";
import { rpcClient } from "@/client/rpc/client";
import { type Draft, holdsSomething, isOnItsWay } from "@/shared/drafts";
import { keptTabGroupsOf, TAB_GROUPS_KEY } from "@/shared/kept-state";
import { asksMoreThan } from "@/shared/tab-identity";
import { neighborAt, type SidebarPlace } from "@/shared/tabs";
import { type ChatId, StoreId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { unique } from "radashi";
import { atom, useAtomValue, useStore } from "jotai";
import { useEffect, useEffectEvent, useRef } from "react";

import {
  appTabsAtom,
  groupOfHref,
  INBOX_HREF,
  isSiteGroup,
  openInNewWindow,
  useAppTabs,
} from "./app-tabs";
import {
  groupReturnAtom,
  type GroupReturns,
  returnAfterArrival,
} from "./group-return";
import { chatListOptions } from "./chat-list-query";
import { type Chat, draftTitle, type Project } from "./chats";
import { isGroupScreenHref } from "./group-screen";
import { sidebarRowOrderAtom } from "./held-chord-hints";
import { useTabGroupsElsewhere, windowTabGroupsAtom } from "./open-groups";
import {
  besideOf,
  chatOfTab,
  chatUpIn,
  draftOfTab,
  groupLayoutOf,
  isBlankNewTab,
  isNewChatTab,
  selectedTabIn,
  sideIndexOf,
  tabShowing,
  tabsIn,
  type WindowTabs,
} from "./tab-model";
import { openLinkAddress } from "./open-link-address";
import {
  chatHref,
  groupHref,
  LINK_ADDRESSES,
  matchScreen,
  newChatHref,
  newGroupKey,
} from "./window-href";
import {
  glintingNewChatTabsAtom,
  newScreenId,
  useTabsAtom,
  useWindowTabs,
  windowTabsAtom,
} from "./window-tabs";

/**
 * One tab group as the sidebar lists it. Its row is titled by the tab up on
 * its side with the keyboard; `kind` says what else it shows: a chat up on
 * either side (the side with the keyboard first), whose latest line and
 * state its row shows, a new chat with words in it up with the keyboard, or
 * tabs alone. A chat's state is the chat's own, so every row with a tab up
 * on one chat shows it. A group is `pinned` by its own pin, and in the
 * `project` it was made in, whatever its chats are filed under.
 */
export type TabGroup =
  | {
      chat: Chat;
      group: string;
      kind: "chat";
      pinned: boolean;
      project?: string;
      title: string;
    }
  | {
      draft: Draft;
      group: string;
      kind: "draft";
      pinned: boolean;
      project?: string;
      title: string;
    }
  | {
      group: string;
      kind: "tabs";
      pinned: boolean;
      project?: string;
      title: string;
    };

/**
 * A window's groups with one more: at the top, under New, unless it has it
 * already, or at a place, where it moves to when it is listed already. A
 * place names groups the list has, so it holds whatever else the list keeps
 * that the sidebar does not show; one naming none it has is the top.
 */
export function listedWith(
  list: null | readonly string[],
  group: string,
  place?: SidebarPlace,
): string[] {
  const listed = list ?? [];
  if (place === undefined) {
    return listed.includes(group) ? [...listed] : [group, ...listed];
  }
  const rest = listed.filter((entry) => entry !== group);
  const before = place.before === undefined ? -1 : rest.indexOf(place.before);
  if (before !== -1) {
    return rest.toSpliced(before, 0, group);
  }
  const after = place.after === undefined ? -1 : rest.indexOf(place.after);
  return rest.toSpliced(after + 1, 0, group);
}

/** A window's groups without one. */
export function listedWithout(
  list: null | readonly string[],
  group: string,
): string[] {
  return (list ?? []).filter((entry) => entry !== group);
}

/**
 * A window that has kept no tab groups yet starts from none: no chat open,
 * and the one tab it has at the inbox, where a new group opens for it. What
 * an earlier build left in its tabs is not carried in.
 */
export function startTabGroupsFromZero(store: ReturnType<typeof useStore>) {
  if (store.get(windowTabGroupsAtom) !== null) {
    return;
  }
  store.set(windowTabGroupsAtom, []);
  const id = freshTabId();
  store.set(appTabsAtom, {
    recentlyClosed: [],
    selectedId: id,
    tabs: [{ id, pathname: INBOX_HREF }],
  });
}

/** Whether a group is pinned above the line, by its own pin. */
export function isPinnedGroup(entry: TabGroup): boolean {
  return entry.pinned;
}

/** What a new chat is called by its words alone: "New Tab" until it has some. */
function draftWordsTitle(draft: Draft): string {
  return draft.words.trim() === "" ? "New Tab" : draftTitle(draft.words);
}

/**
 * Whether a draft is worth keeping: a new chat's, not on its way, with
 * words or files in it.
 */
export function isWorthKeeping(draft: Draft): boolean {
  return (
    draft.chatId === undefined && !isOnItsWay(draft) && holdsSomething(draft)
  );
}

/**
 * The project the sidebar lists a group in: none for one whose project is
 * retired or gone, which has no row to open it from.
 */
export function listedProject(
  entry: TabGroup,
  projects: readonly Project[],
): string | undefined {
  return projects.some(
    (project) => project.id === entry.project && !project.retired,
  )
    ? entry.project
    : undefined;
}

/**
 * The groups the sidebar lists while it stands in a project, or at its root
 * with none: each group is in one set alone.
 */
export function groupsInProject(
  open: readonly TabGroup[],
  project: string | undefined,
  projects: readonly Project[],
): TabGroup[] {
  return open.filter(
    (entry) =>
      (project === undefined
        ? listedProject(entry, projects)
        : entry.project) === project,
  );
}

/** One open group, as its row lists it (see `TabGroup`). */
function openEntry(
  group: string,
  {
    byId,
    drafts,
    state,
  }: {
    byId: ReadonlyMap<string, Chat>;
    drafts: readonly Draft[];
    state: WindowTabs;
  },
): TabGroup {
  const own = {
    group,
    pinned: state.groups?.[group]?.pinned === true,
    project: state.groups?.[group]?.project,
  };
  const up = selectedTabIn(state, group);
  const upChat = chatUpIn(state, group);
  const chat = upChat === undefined ? undefined : byId.get(upChat);
  if (chat) {
    return { ...own, chat, kind: "chat", title: chat.title };
  }
  const draft =
    up === undefined
      ? undefined
      : drafts.find(
          (entry) => entry.id === draftOfTab(up) && entry.words.trim() !== "",
        );
  if (draft) {
    return { ...own, draft, kind: "draft", title: draftWordsTitle(draft) };
  }
  return { ...own, kind: "tabs", title: "New Tab" };
}

/** The tab groups as this window lists them (`groupLists`). */
export function useOpenGroups(): GroupLists {
  return groupLists({
    chats: useQuery(chatListOptions()).data ?? [],
    drafts: useAtomValue(draftsAtom),
    elsewhere: useTabGroupsElsewhere(),
    listed: useAtomValue(windowTabGroupsAtom) ?? [],
    state: useAtomValue(useTabsAtom()),
  });
}

interface GroupLists {
  elsewhere: TabGroup[];
  open: TabGroup[];
}

/**
 * The tab groups as a window lists them: its own open ones in its order,
 * and the groups another open window has open.
 */
export function groupLists({
  chats,
  drafts,
  elsewhere,
  listed,
  state,
}: {
  chats: readonly Chat[];
  drafts: readonly Draft[];
  /** The groups the other open windows have open, as main says; undefined until it answers. */
  elsewhere: readonly string[] | undefined;
  listed: readonly string[];
  state: WindowTabs;
}): GroupLists {
  const byId = new Map<string, Chat>(chats.map((chat) => [chat.id, chat]));
  const isListed = new Set(listed);
  return {
    elsewhere: (elsewhere ?? [])
      .filter(
        (group) =>
          !isListed.has(group) && state.tabs.some((tab) => tab.group === group),
      )
      .map((group) => openEntry(group, { byId, drafts, state })),
    open: listed.map((group) => openEntry(group, { byId, drafts, state })),
  };
}

/** The chats no tab group in this window has a tab on. */
export function chatsWithNoTab(
  chats: readonly Chat[],
  state: WindowTabs,
): Chat[] {
  const withTabs = new Set(
    state.tabs.flatMap((tab) =>
      tab.group === undefined ? [] : [chatOfTab(tab)],
    ),
  );
  return chats.filter((chat) => !withTabs.has(chat.id));
}

/** Groups in the order the sidebar lists them: pinned ones first, whatever their places in the window's own list. */
export function inSidebarOrder(open: readonly TabGroup[]): TabGroup[] {
  return [
    ...open.filter((entry) => isPinnedGroup(entry)),
    ...open.filter((entry) => !isPinnedGroup(entry)),
  ];
}

/**
 * The group a step down (1) or up (-1) the sidebar lands on from `from`, in
 * the order the sidebar lists them, pinned ones first; from no group, the
 * first or the last.
 */
export function groupAlong(
  open: readonly TabGroup[],
  from: string | undefined,
  direction: -1 | 1,
): string | undefined {
  const listed = inSidebarOrder(open);
  const at = listed.findIndex((entry) => entry.group === from);
  if (at === -1) {
    return (direction === 1 ? listed[0] : listed.at(-1))?.group;
  }
  return listed[at + direction]?.group;
}

/**
 * A window's list as upkeep keeps it: every listed group with tabs, and each
 * pinned one with none, which gets a new tab (`opening`). The rest leave the
 * list, so a pinned group never does.
 */
export function upkeptList(
  listed: readonly string[],
  state: WindowTabs,
): { kept: string[]; opening: { group: string; href: string }[] } {
  const opening: { group: string; href: string }[] = [];
  const kept = listed.filter((group) => {
    if (tabsIn(state, group).length > 0) {
      return true;
    }
    const isPinned = state.groups?.[group]?.pinned === true;
    if (isPinned) {
      opening.push({ group, href: NEW_TAB_HREF });
    }
    return isPinned;
  });
  return { kept, opening };
}

/** Whether a group is one new tab and nothing else: nothing written in it, and nowhere to go back to. */
function isEmptyGroup(state: WindowTabs, group: string): boolean {
  const [only, ...others] = tabsIn(state, group);
  return only !== undefined && others.length === 0 && isBlankNewTab(only);
}

/**
 * A group's tabs as its copy starts with them, in their order and each
 * under a new id (`newId`), in `group`: a page at the address it shows,
 * with its title and icon until it loads, and a screen at its own address,
 * a chat's included, since a chat may have any number of tabs. A new chat
 * is copied as a new chat with nothing in it, since its draft is one
 * composer's. None takes its history. `up` and `beside` are the copies of
 * the tabs they name: the tab up on the side with the keyboard, and on the
 * other side.
 */
export function copiedTabs(
  tabs: readonly WindowTab[],
  {
    beside,
    group,
    newId,
    now,
    up,
  }: {
    beside?: string;
    group: string;
    newId: () => string;
    now: number;
    up?: string;
  },
): { beside: string | undefined; tabs: WindowTab[]; up: string | undefined } {
  let upCopy: string | undefined;
  let besideCopy: string | undefined;
  const copies = tabs.map((tab): WindowTab => {
    const id = newId();
    if (tab.id === up) {
      upCopy = id;
    }
    if (tab.id === beside) {
      besideCopy = id;
    }
    const side = tab.side === 1 ? { side: 1 as const } : {};
    if (tab.kind === "screen") {
      const href = isNewChatTab(tab) ? newChatHref() : tab.href;
      return { group, href, id, kind: "screen", ...side };
    }
    const address = tab.url ?? tab.openedUrl;
    return {
      ...(tab.favicon === undefined ? {} : { favicon: tab.favicon }),
      group,
      id,
      kind: "page",
      openedAt: now,
      ...(address === undefined ? {} : { openedUrl: address, url: address }),
      ...side,
      ...(tab.title === undefined ? {} : { title: tab.title }),
    };
  });
  return { beside: besideCopy, tabs: copies, up: upCopy };
}

/** How soon after one New another is a held key's repeat. */
const NEW_REPEAT_MS = 150;

/** How long a tab New made counts as just made: as long as its glint runs. */
const JUST_MADE_MS = 750;

/** When New was last asked for in the window, and the tab it made, if it made one. */
type LastNew = { at: number; made: string | undefined };

const lastNewAtom = atom<LastNew | undefined>(undefined);

/**
 * Whether New, asked for over `over` (`emptyNewChatUp`), glints a composer:
 * only over an empty new chat, where nothing else on screen would change,
 * and never on a held key's repeat or over a tab New itself just made. New
 * that opens a tab skips one still glinting too; New that brings up the tab
 * already up plays its glint again.
 */
export function glintsForNew(
  over: string | undefined,
  {
    glinting,
    last,
    now,
    opensTab,
  }: {
    glinting: ReadonlyMap<string, number>;
    last: LastNew | undefined;
    now: number;
    opensTab: boolean;
  },
): boolean {
  if (over === undefined) {
    return false;
  }
  if (last !== undefined) {
    const since = now - last.at;
    if (since < NEW_REPEAT_MS || (last.made === over && since < JUST_MADE_MS)) {
      return false;
    }
  }
  return !(opensTab && glinting.has(over));
}

/** The group's tab up when it is an empty new chat, where a new tab or New changes nothing on screen. */
export function emptyNewChatUp(
  state: WindowTabs,
  group: string | undefined,
): WindowTab | undefined {
  const up = group === undefined ? undefined : selectedTabIn(state, group);
  return up !== undefined && isNewChatTab(up) && draftOfTab(up) === undefined
    ? up
    : undefined;
}

/** A screen tab at an address, in a group. */
function screenTab(group: string, href: string): WindowTab {
  return { group, href, id: newScreenId(), kind: "screen" };
}

/**
 * What the window does with its tab groups: make one, bring one up (in the
 * window that has it open, when another does), close one, open a chat or a
 * draft as a group of its own, and move one to a window of its own.
 */
export function useTabGroupActions() {
  const store = useStore();
  const appTabs = useAppTabs();
  const windowTabs = useWindowTabs();

  /**
   * The group the window shows now, read at the call from the tab's own
   * router, which has moved before the model hears of it: a second Cmd+W
   * right after the first acts on the group that came up.
   */
  const groupUp = () => {
    const model = store.get(appTabsAtom);
    const up = model.tabs.find((tab) => tab.id === model.selectedId);
    return (
      up &&
      groupOfHref(getTabRouter(up.id)?.history.location.href ?? up.pathname)
    );
  };

  /** Glints the composer of a tab, again when it already is (`glintingNewChatTabsAtom`). */
  const glint = (tab: string | undefined) => {
    if (tab !== undefined) {
      store.set(glintingNewChatTabsAtom, (ids) =>
        new Map(ids).set(tab, (ids.get(tab) ?? 0) + 1),
      );
    }
  };

  /**
   * New asked for over `over`, the empty new chat up if any: whether it
   * glints (`glintsForNew`), noted as the last New with the tab it made.
   */
  const askNew = (
    over: string | undefined,
    { opensTab }: { opensTab: boolean },
  ) => {
    const now = Date.now();
    const glints = glintsForNew(over, {
      glinting: store.get(glintingNewChatTabsAtom),
      last: store.get(lastNewAtom),
      now,
      opensTab,
    });
    return {
      glints,
      made: (tab: string | undefined) => {
        store.set(lastNewAtom, { at: now, made: tab });
      },
    };
  };

  /** Changes this window's list of groups, as it stands at the call. */
  const setListed = (
    update: (list: null | readonly string[]) => readonly string[],
  ) => {
    store.set(windowTabGroupsAtom, update(store.get(windowTabGroupsAtom)));
  };

  const isListedHere = (group: string) =>
    store.get(windowTabGroupsAtom)?.includes(group) === true;

  /** Whether another window, open or closed to come back, lists a group. */
  const isListedElsewhere = (group: string) =>
    keptInOtherWindows(TAB_GROUPS_KEY).some((kept) =>
      keptTabGroupsOf(kept)?.includes(group),
    );

  /** Brings a group up here, at the top of the list when it was not open here. */
  const showHere = (group: string, { replace = false } = {}) => {
    setListed((list) => listedWith(list, group));
    appTabs.navigate(groupHref(group), { replace });
  };

  /**
   * Brings a group up: here when it is open here or in no other window, and
   * otherwise in the window that has it open, which comes forward, since a
   * group is open in one window at a time.
   */
  const show = (group: string) => {
    if (isListedHere(group)) {
      appTabs.navigate(groupHref(group));
      return;
    }
    // Closed windows that can come back are among these; main looks only
    // at the open ones, and says no for the rest.
    if (!isListedElsewhere(group)) {
      showHere(group);
      return;
    }
    void rpcClient.window.showInOtherWindow
      .call({ href: groupHref(group) })
      .then((shown) => {
        if (!shown) {
          showHere(group);
        }
      });
  };

  /** A group off this window's list, its tabs and its own record gone with it. */
  const drop = (group: string) => {
    setListed((list) => listedWithout(list, group));
    windowTabs.dropGroup(group);
  };

  /**
   * A new tab beside the last tab of a pinned group, which an agent is about
   * to take out of it, so the group and its pin stay. Answers whether the
   * group needed one.
   */
  const keepPinned = (tab: WindowTab): boolean => {
    const state = store.get(windowTabsAtom);
    const { group } = tab;
    if (
      group === undefined ||
      state.groups?.[group]?.pinned !== true ||
      tabsIn(state, group).some((each) => each.id !== tab.id)
    ) {
      return false;
    }
    windowTabs.openIn(screenTab(group, NEW_TAB_HREF), {
      group,
      select: false,
    });
    return true;
  };

  /**
   * A tab into another group, up there with the keyboard, at the end of the
   * side with it, or of the side `placing` names, made there when it
   * `split`s. A group the tab leaves with nothing closes, unless it is
   * pinned and the move `keepsPinned`, which leaves it a new tab. With
   * `keepsKeyboard`, the group's tab with the keyboard keeps it and stays up:
   * the tab moved comes up only on the other side.
   */
  const moveTab = (
    id: string,
    group: string,
    placing?: { index?: number; side: 0 | 1; split: boolean },
    {
      keepsKeyboard = false,
      keepsPinned = false,
    }: { keepsKeyboard?: boolean; keepsPinned?: boolean } = {},
  ) => {
    const found = store
      .get(windowTabsAtom)
      .tabs.find((entry) => entry.id === id);
    if (keepsPinned && found !== undefined && found.group !== group) {
      keepPinned(found);
    }
    const state = store.get(windowTabsAtom);
    const tab = state.tabs.find((entry) => entry.id === id);
    const sideWas = sideIndexOf(groupLayoutOf(state, group), id);
    const inUse = keepsKeyboard ? selectedTabIn(state, group)?.id : undefined;
    const isInUse = inUse === undefined || inUse === id;
    windowTabs.moveTo({
      group,
      id,
      select: isInUse,
      side: placing?.side ?? groupLayoutOf(state, group).focused,
      ...(placing?.index === undefined ? {} : { index: placing.index }),
      ...(placing?.split === true ? { split: true } : {}),
    });
    if (!isInUse) {
      const layout = groupLayoutOf(store.get(windowTabsAtom), group);
      const side = sideIndexOf(layout, id);
      if (side !== sideWas && side !== layout.focused) {
        windowTabs.raise(id);
      }
    }
    const from = tab?.group;
    if (from !== undefined && from !== group) {
      const left = tabsIn(state, from).filter((entry) => entry.id !== id);
      if (left.length === 0) {
        drop(from);
      }
    }
  };

  /**
   * Moves tabs as an agent asks, in the order given (`moveTab`): into a
   * group, onto a side of one, or to a place beside a tab. The tab the
   * person has the keyboard in, in a group on screen here or one the tabs are
   * placed in, keeps it, and the window goes where its tabs went when the
   * group it shows is left none.
   */
  const moveTabs = (
    ids: readonly string[],
    group: string,
    {
      place,
      side,
    }: {
      place?: { anchor: string; where: "after" | "before" };
      side?: 0 | 1;
    } = {},
  ) => {
    const onScreen = groupUp();
    const keeps = {
      keepsKeyboard:
        place !== undefined || side !== undefined || group === onScreen,
      keepsPinned: true,
    };
    let anchor = place?.anchor;
    for (const id of ids) {
      const layout = groupLayoutOf(store.get(windowTabsAtom), group);
      const anchorSide =
        anchor === undefined ? undefined : sideIndexOf(layout, anchor);
      if (place && anchorSide !== undefined) {
        // Its place along the strip it goes into, counted without it.
        const at = (layout.sides[anchorSide]?.tabs ?? [])
          .filter((tab) => tab.id !== id)
          .findIndex((tab) => tab.id === anchor);
        moveTab(
          id,
          group,
          {
            index: place.where === "after" ? at + 1 : at,
            side: anchorSide,
            split: false,
          },
          keeps,
        );
        anchor = place.where === "after" ? id : anchor;
      } else if (side === undefined) {
        moveTab(id, group, undefined, keeps);
      } else if (layout.sides.length < 2 || sideIndexOf(layout, id) !== side) {
        moveTab(id, group, { side, split: layout.sides.length < 2 }, keeps);
      }
    }
    if (onScreen !== undefined && onScreen !== group && !hasTabs(onScreen)) {
      show(group);
    }
  };

  const setReturn = (group: string, returns: GroupReturns) => {
    const to = groupUp();
    store.set(
      groupReturnAtom,
      to === undefined ? undefined : { group, once: returns === "once", to },
    );
  };

  /**
   * A new group at the top of the list, under New, or at a place in it,
   * pinned there when the place is among the pinned rows: one side with a
   * new chat in it, unless something else is to open in it. One shown here
   * is in the project the sidebar stands in, unless another, or none, is
   * named.
   */
  const make = ({
    fill,
    href,
    isShownHere = true,
    moving,
    pinned = false,
    place,
    project,
    replace = false,
    returns,
  }: {
    /** Opens what the group starts with. */
    fill?: (group: string) => void;
    /** A screen the group starts on, as a tab. */
    href?: string;
    /** Whether this window comes up on it: not for one a window of its own is opening on. */
    isShownHere?: boolean;
    /** A tab to move into the new group in place of opening one. */
    moving?: string;
    /** Whether it is pinned, wherever it goes. */
    pinned?: boolean;
    /** Where it goes in the list, when not at the top. */
    place?: SidebarPlace;
    /** The project it is in, or null for the root. */
    project?: null | string;
    /** Takes the place of the window's address rather than stepping on from it. */
    replace?: boolean;
    /** Closing it goes back to the group up now (`GroupReturn`): until the person goes on to another, or, for `once`, switches away at all. */
    returns?: GroupReturns;
  } = {}) => {
    const group = newGroupKey();
    if (returns !== undefined && isShownHere) {
      setReturn(group, returns);
    }
    const into =
      project === undefined && isShownHere
        ? store.get(sidebarProjectAtom)
        : project;
    if (into) {
      windowTabs.setGroupOwn(group, { project: into });
    }
    if (isShownHere) {
      setListed((list) => listedWith(list, group, place));
    }
    if (pinned || place?.pinned === true) {
      windowTabs.setGroupOwn(group, { pinned: true });
    }
    if (fill) {
      fill(group);
    } else if (moving !== undefined) {
      moveTab(moving, group);
    } else {
      const tab = screenTab(group, href ?? NEW_TAB_HREF);
      windowTabs.openIn(tab, { group, select: true });
    }
    if (isShownHere) {
      // From a screen or page that is no tab group's, the new group takes its place.
      const up = groupUp();
      appTabs.navigate(groupHref(group), {
        replace: replace || up === undefined || isSiteGroup(up),
      });
    }
    return group;
  };

  /**
   * New, as the person asks for it: the empty group this window already
   * has in the project the sidebar stands in comes up, its box with the
   * keyboard, and a group is made only when there is none, so the window
   * never has two of them. Asked over an empty new chat, where nothing on
   * screen would change, the composer that comes up glints.
   */
  const openNew = () => {
    const state = store.get(windowTabsAtom);
    const project = store.get(sidebarProjectAtom);
    const empty = (store.get(windowTabGroupsAtom) ?? []).find(
      (group) =>
        isEmptyGroup(state, group) &&
        state.groups?.[group]?.project === project,
    );
    const over = emptyNewChatUp(state, groupUp())?.id;
    if (empty === undefined) {
      const asked = askNew(over, { opensTab: true });
      const group = make({ returns: "once" });
      const tab = selectedTabIn(store.get(windowTabsAtom), group)?.id;
      asked.made(tab);
      if (asked.glints) {
        glint(tab);
      }
    } else if (empty === groupUp()) {
      const asked = askNew(over, { opensTab: false });
      asked.made(undefined);
      // The keyboard may be elsewhere on the group, on a row under its box,
      // where the home would leave it.
      leaveField(document.activeElement);
      if (asked.glints) {
        glint(over);
      }
    } else {
      askNew(undefined, { opensTab: false }).made(undefined);
      setReturn(empty, "once");
      appTabs.navigate(groupHref(empty));
    }
  };

  /**
   * A copy of a group just below it, up in this window: its tabs copied
   * (`copiedTabs`) on the same sides, the same one up on each and the
   * keyboard on the same side, pinned as the group is.
   */
  const duplicate = (entry: TabGroup) => {
    const tabs = store.get(windowTabsAtom);
    const up = selectedTabIn(tabs, entry.group)?.id;
    make({
      fill: (group) => {
        const copied = copiedTabs(tabsIn(tabs, entry.group), {
          beside: up === undefined ? undefined : besideOf(tabs, up)?.id,
          group,
          newId: () => StoreId.newTabId(),
          now: Date.now(),
          up,
        });
        windowTabs.restoreGroup(group, copied.tabs);
        if (copied.up !== undefined) {
          windowTabs.bringUp(copied.up);
        }
        if (copied.beside !== undefined) {
          windowTabs.raise(copied.beside);
        }
      },
      place: { after: entry.group, ...(entry.pinned ? { pinned: true } : {}) },
      returns: "untilUnrelated",
    });
  };

  /**
   * The group to show once `group` is gone: the one it goes back to
   * (`GroupReturn`) while that is in the list, else the row under it in the sidebar,
   * else the one above, else none. The rows are read as the sidebar shows
   * them, or worked out from `list` where no row of it shows the group. A row
   * can outlast its group until the next render, so only groups still on this
   * window's list count.
   */
  const neighborOf = (group: string, list: readonly TabGroup[]) => {
    const project = store.get(sidebarProjectAtom);
    const rows = store.get(sidebarRowOrderAtom);
    const order = rows?.includes(group)
      ? rows
      : inSidebarOrder(
          list.filter(
            (entry) => entry.group === group || entry.project === project,
          ),
        ).map((entry) => entry.group);
    const left = order.filter((each) => each === group || isListedHere(each));
    const back = store.get(groupReturnAtom);
    if (back?.group === group && left.includes(back.to)) {
      return back.to;
    }
    const at = left.indexOf(group);
    return at === -1 ? left[0] : neighborAt(left, at);
  };

  /**
   * Closes a group: it leaves this window's list and goes, tabs and all. Its
   * chats go on with whatever they were doing, and one with no tab left
   * anywhere is in the side panel's chat list. The window moves on to the next
   * group when it was showing this one.
   */
  const close = (group: string, list: readonly TabGroup[]) => {
    drop(group);
    moveOff(group, list);
  };

  /**
   * Closes several groups at once, each as `close` does, the way a row's
   * menu closes the rows around it: when the window was showing one of
   * them, it moves to `keep`, the group whose menu asked.
   */
  const closeAll = (groups: readonly string[], keep: string) => {
    const up = groupUp();
    for (const group of groups) {
      drop(group);
    }
    if (up !== undefined && groups.includes(up)) {
      appTabs.navigate(groupHref(keep), { replace: true });
    }
  };

  /** A group off this window's list, for another window to have open, with nothing about it changed. */
  const letGo = (group: string, list: readonly TabGroup[]) => {
    setListed((listed) => listedWithout(listed, group));
    moveOff(group, list);
  };

  /**
   * A group into a window of its own, which has it open from then on: off
   * this window's list once the new one lists it, so it is never listed
   * nowhere.
   */
  const moveToNewWindow = (group: string, list: readonly TabGroup[]) => {
    void openInNewWindow(groupHref(group)).then((opened) => {
      if (opened) {
        letGo(group, list);
      }
    });
  };

  /**
   * A group, or tabs as a group of their own, put in a new window for an
   * agent; answers the group the window opened on, or why none did. Only
   * what this window has, and never all of it, which is in a window of its
   * own already. Tabs that are a whole group go as that group, with its pin
   * and project, and a pinned group that loses some but not all keeps its own.
   */
  const openWindowFor = async (
    moving: { group: string } | { tabs: readonly string[] },
    list: readonly TabGroup[],
  ): Promise<{ error: string } | { group: string }> => {
    const state = store.get(windowTabsAtom);
    const listed = store.get(windowTabGroupsAtom) ?? [];
    const ids =
      "group" in moving
        ? tabsIn(state, moving.group).map((tab) => tab.id)
        : moving.tabs;
    const isMoving = (tab: { id: string }) => ids.includes(tab.id);
    const froms = [
      ...new Set(state.tabs.filter(isMoving).flatMap((tab) => tab.group ?? [])),
    ];
    if (ids.length === 0 || froms.some((group) => !listed.includes(group))) {
      return {
        error:
          "that is not in the window you work in, so no window opened; it goes to a new one from its own.",
      };
    }
    const emptied = froms.filter((group) =>
      tabsIn(state, group).every(isMoving),
    );
    if (listed.every((group) => emptied.includes(group))) {
      return {
        error:
          "that is everything the window has, so it is in a window of its own already.",
      };
    }
    const [from] = froms;
    const isWhole = froms.length === 1 && emptied.length === 1;
    const group = isWhole && from !== undefined ? from : undefined;
    if (group === undefined) {
      for (const each of emptied) {
        if (state.groups?.[each]?.pinned !== true) {
          moveOff(
            each,
            list.filter(
              (entry) => !emptied.includes(entry.group) || entry.group === each,
            ),
          );
        }
      }
    }
    const opening =
      group ??
      make({
        fill: (made) => {
          for (const id of ids) {
            moveTab(id, made, undefined, { keepsPinned: true });
          }
        },
        isShownHere: false,
      });
    const opened = await rpcClient.window.openNew
      .call({
        byAgent: true,
        tabs: [{ id: freshTabId(), pathname: groupHref(opening) }],
      })
      .catch(() => false);
    if (!opened) {
      if (group === undefined) {
        place(opening, {});
      }
      return { error: "no window could be opened." };
    }
    letGo(opening, list);
    return { group: opening };
  };

  /** Pins a group above the line, or takes it back down, by its own pin. */
  const pin = (group: string, pinned: boolean) => {
    windowTabs.setGroupOwn(group, { pinned: pinned ? true : undefined });
  };

  /** A group to a place in this window's list, pinned there or unpinned when the place says (`pin`). */
  const place = (group: string, at: SidebarPlace) => {
    if (at.pinned !== undefined) {
      pin(group, at.pinned);
    }
    setListed((list) => listedWith(list, group, at));
  };

  /** The window off a group that is going, to the next in the list, when it was showing it. */
  const moveOff = (group: string, list: readonly TabGroup[]) => {
    if (groupUp() !== group) {
      return;
    }
    const next = neighborOf(group, list);
    if (next === undefined) {
      make();
    } else {
      appTabs.navigate(groupHref(next), { replace: true });
    }
  };

  /**
   * Opens a chat as a new tab group of its own, at the top of the list and
   * up in the window, however many tabs it has elsewhere: a chat opens as
   * often as it is asked for, and no tab already on it is brought up in its
   * place.
   */
  const openChat = (
    chat: ChatId,
    options: { replace?: boolean; returns?: "untilUnrelated" } = {},
  ) => {
    make({ href: chatHref(chat), ...options });
  };

  /**
   * Brings forward a chat asked for from outside the window's own clicks (a
   * notification, the bell, a link from another app, its address): the tab
   * on it the person last sent from comes up in its group, here or in the
   * window that has it, and a chat with no tab opens as a group of its own
   * (`openChat`). With `replace`, the window's address it was asked at is
   * replaced rather than walked past.
   */
  const revealChat = (chat: ChatId, options: { replace?: boolean } = {}) => {
    const tab = windowTabs.chatTab(chat);
    if (tab?.group === undefined) {
      openChat(chat, options);
      return;
    }
    windowTabs.select(tab.id);
    if (options.replace === true && isListedHere(tab.group)) {
      appTabs.navigate(groupHref(tab.group), { replace: true });
      return;
    }
    show(tab.group);
  };

  /**
   * Lists a chat nobody asked to look at (one a phone started on this
   * computer) as a group of its own at the top of the list, outside any
   * project, with the group up left up. Nothing for a chat with a tab in any
   * group, here or in another window.
   */
  const listChat = (chat: ChatId) => {
    const isOpen = store
      .get(windowTabsAtom)
      .tabs.some((tab) => tab.group !== undefined && chatOfTab(tab) === chat);
    if (isOpen) {
      return;
    }
    const group = make({
      href: chatHref(chat),
      isShownHere: false,
      project: null,
    });
    setListed((list) => listedWith(list, group));
  };

  /**
   * Puts up one thing handed over from outside the app (a link, a file from
   * the Finder): a tab in one of this window's groups already showing
   * exactly it (`tabShowing`) comes up in its group, walked to the part
   * asked for where it stands elsewhere in it (another part of Settings),
   * and is given back for the window to light. Otherwise it opens as a new
   * group of its own, since something from outside never joins a group the
   * person has; `returns` says how long a group made goes back to the one up
   * now (`GroupReturn`).
   */
  const showOrMake = (
    href: string,
    { returns }: { returns?: GroupReturns } = {},
  ): undefined | WindowTab => {
    const tab = tabShowing(
      store.get(windowTabsAtom),
      store.get(windowTabGroupsAtom) ?? [],
      href,
      { exact: true, onScreen: groupUp() },
    );
    if (tab?.group === undefined) {
      make({ href, ...(returns === undefined ? {} : { returns }) });
      return undefined;
    }
    windowTabs.select(tab.id);
    if (tab.kind === "screen" && asksElsewhereThan(href, tab.href)) {
      windowTabs.visitHref(tab.id, href);
    }
    show(tab.group);
    return tab;
  };

  /**
   * Brings up the tab already writing a draft, so one draft is never in two
   * composers: up in its group, here or in the window that lists the group,
   * which comes forward (`show`). Every window's group tabs are one record,
   * so a tab in another window's group is found here too. Answers with the
   * tab, or undefined where no tab is writing the draft. With `replace`, the
   * window's address the draft was asked at is replaced rather than walked
   * past, and a window that hands the draft to another goes back to a group
   * of its own.
   */
  const revealDraft = (
    draft: string,
    { replace = false }: { replace?: boolean } = {},
  ): undefined | WindowTab => {
    const state = store.get(windowTabsAtom);
    const here = store.get(windowTabGroupsAtom) ?? [];
    const tab = tabShowing(
      state,
      unique([...here, ...state.tabs.flatMap((each) => each.group ?? [])]),
      newChatHref(draft),
      { exact: true, onScreen: groupUp() },
    );
    if (tab?.group === undefined) {
      return undefined;
    }
    windowTabs.select(tab.id);
    if (replace && isListedHere(tab.group)) {
      appTabs.navigate(groupHref(tab.group), { replace: true });
      return tab;
    }
    if (replace) {
      const [first] = here;
      if (first === undefined) {
        make({ replace: true });
      } else {
        appTabs.navigate(groupHref(first), { replace: true });
      }
    }
    show(tab.group);
    return tab;
  };

  /**
   * Brings up a kept draft's new chat: the tab already writing it
   * (`revealDraft`), or else a new tab group of its own (`openChat`).
   */
  const openDraft = (draft: string, options: { replace?: boolean } = {}) => {
    if (revealDraft(draft, options) === undefined) {
      make({ href: newChatHref(draft), ...options });
    }
  };

  /**
   * A new chat in a group, up at once with the keyboard: at the end of the
   * side with the keyboard, as a browser's new tab is. In a new group when
   * none is up. Opened over an empty new chat, its composer glints.
   */
  const newTab = (group = groupUp()) => {
    if (group === undefined) {
      const asked = askNew(undefined, { opensTab: true });
      const made = make();
      asked.made(selectedTabIn(store.get(windowTabsAtom), made)?.id);
      return;
    }
    const asked = askNew(emptyNewChatUp(store.get(windowTabsAtom), group)?.id, {
      opensTab: true,
    });
    const tab = windowTabs.openScreen(NEW_TAB_HREF, {
      from: { reason: "newTab" },
      group,
      select: true,
    });
    asked.made(tab);
    if (asked.glints) {
      glint(tab);
    }
  };

  /** Whether a group has tabs, read now. */
  const hasTabs = (group: string) =>
    store.get(windowTabsAtom).tabs.some((tab) => tab.group === group);

  return {
    close,
    closeAll,
    duplicate,
    groupUp,
    hasTabs,
    keepPinned,
    letGo,
    listChat,
    make,
    moveOff,
    moveTab,
    moveTabs,
    moveToNewWindow,
    newTab,
    openChat,
    openNew,
    openWindowFor,
    openDraft,
    pin,
    place,
    revealChat,
    show,
    showHere,
    revealDraft,
    showOrMake,
  };
}

/**
 * Whether an address asks the tab already showing its thing to go somewhere
 * it is not: another part of Settings, or a selection or layout the tab does
 * not have (`asksMoreThan`). A file's tab with its folder and layout as the
 * person left them asks nothing more of a bare link to the file.
 */
function asksElsewhereThan(asked: string, shown: string): boolean {
  const pathOf = (href: string) =>
    new URL(href, "http://tabs").pathname.replace(/\/$/, "");
  return pathOf(asked) !== pathOf(shown) || asksMoreThan(asked, shown);
}

/** Whether an address asks for a draft by its id, which upkeep can act on only once main has read the drafts. Every other address, a new tab's included, is kept without them. */
export function asksForDraft(href: string): boolean {
  const screen = matchScreen(href);
  return screen.kind === "inbox" && screen.draft !== undefined;
}

/**
 * Keeps what the window's one app tab stands on a tab group of this
 * window's list. A group the tab came to some other way than through the
 * list (a step back) joins it at the top. A chat's or a draft's address
 * opens it as a group of its own, once per ask. A listed group with no tabs
 * leaves the list, unless it is pinned, which gets a new tab. Everything
 * else sits inside a group too: a screen, a page or an address no screen
 * answers that the app tab came to on its own (a launch, a script) becomes a
 * tab of the group last up, or of a new group, a link address opens where it
 * lives, and the inbox shows the group last up, or the first, or a new one.
 * Groups another
 * window has open too leave this one's list once, as it opens, unless this
 * window is showing them: a window closed with them and brought back since
 * they were opened elsewhere. A draft's address waits until main has read
 * the drafts, since a draft missing before then may only be unread; nothing
 * else here reads a draft, so the window never waits on them for a group to
 * show.
 */
export function useTabGroupUpkeep(href: string, open: readonly TabGroup[]) {
  const store = useStore();
  const appTabs = useAppTabs();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const drafts = useAtomValue(draftsAtom);
  const draftsLoaded = useAtomValue(draftsLoadedAtom);
  const elsewhere = useTabGroupsElsewhere();
  const lastUp = useRef<string>(undefined);
  const asked = useRef<string>(undefined);

  const keep = useEffectEvent(() => {
    const screen = matchScreen(href);
    const isDraftAsked = asksForDraft(href);
    if (isDraftAsked && !draftsLoaded) {
      return;
    }
    const listed = store.get(windowTabGroupsAtom) ?? [];
    const state = store.get(windowTabsAtom);
    const { kept, opening } = upkeptList(listed, state);
    for (const { group, href: tabHref } of opening) {
      windowTabs.openIn(screenTab(group, tabHref), { group, select: true });
    }
    if (kept.length !== listed.length) {
      store.set(windowTabGroupsAtom, kept);
    }
    // A chat or a draft asked for by its address, once per ask: a chat open
    // in a tab comes up there.
    if (screen.kind === "chat" || isDraftAsked) {
      if (asked.current === href) {
        return;
      }
      asked.current = href;
      if (screen.kind === "chat") {
        groups.revealChat(screen.chat, { replace: true });
      } else if (screen.kind === "inbox" && screen.draft !== undefined) {
        groups.openDraft(screen.draft, { replace: true });
      }
      return;
    }
    asked.current = undefined;
    const group = groupOfHref(href);
    if (group !== undefined && !isSiteGroup(group)) {
      if (!kept.includes(group)) {
        if (tabsIn(state, group).length === 0) {
          groups.moveOff(group, open);
          return;
        }
        store.set(windowTabGroupsAtom, listedWith(kept, group));
      }
      if (lastUp.current !== group) {
        store.set(groupReturnAtom, (back) => returnAfterArrival(back, group));
        windowTabs.setGroupOwn(group, { shownAt: Date.now() });
      }
      lastUp.current = group;
      return;
    }
    const into =
      lastUp.current !== undefined &&
      open.some((entry) => entry.group === lastUp.current)
        ? lastUp.current
        : undefined;
    if (screen.kind === "inbox") {
      const next = into ?? open[0]?.group;
      if (next === undefined) {
        groups.make();
      } else {
        appTabs.navigate(groupHref(next), { replace: true });
      }
      return;
    }
    if (group !== undefined) {
      // A page opened at the window's own level: its tabs move into a group.
      const pages = windowTabs.allTabs.filter((tab) => tab.group === group);
      const fill = (target: string) => {
        for (const tab of pages) {
          groups.moveTab(tab.id, target);
        }
      };
      if (into === undefined) {
        groups.make({ fill });
      } else {
        fill(into);
        appTabs.navigate(groupHref(into), { replace: true });
      }
      return;
    }
    if (!isGroupScreenHref(href)) {
      if (!Object.hasOwn(LINK_ADDRESSES, screen.kind)) {
        return;
      }
      // A link address the window itself was sent to (a restored tab, a
      // script's goto) opens where it lives, as from any opener, and the
      // window stands on a group again, or at the screen the link names.
      const at = openLinkAddress(href);
      const back = into ?? open[0]?.group;
      if (at !== undefined) {
        appTabs.navigate(at, { replace: true });
      } else if (back === undefined) {
        groups.make();
      } else {
        appTabs.navigate(groupHref(back), { replace: true });
      }
      return;
    }
    // A screen, or an address no screen answers, which its tab says.
    if (into === undefined) {
      groups.make({ href });
    } else {
      windowTabs.openOrFocusScreen(href, { group: into, select: true });
      appTabs.navigate(groupHref(into), { replace: true });
    }
  });
  useEffect(() => {
    keep();
  }, [href, drafts, draftsLoaded]);

  const isDeduped = useRef(false);
  useEffect(() => {
    if (isDeduped.current || elsewhere === undefined) {
      return;
    }
    isDeduped.current = true;
    const listed = store.get(windowTabGroupsAtom);
    const up = groupOfHref(href);
    const kept = listed?.filter(
      (group) => group === up || !elsewhere.includes(group),
    );
    if (listed && kept && kept.length !== listed.length) {
      store.set(windowTabGroupsAtom, kept);
    }
  }, [elsewhere, href, store]);
}
