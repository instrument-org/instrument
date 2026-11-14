import { NEW_TAB_HREF, type WindowTab } from "@/client/atoms/window";
import {
  forgetGroupAtom,
  groupNamesAtom,
  groupPinsAtom,
  starPinsCarriedAtom,
} from "@/client/atoms/tab-groups";
import { pickNewChatProjectAtom } from "@/client/drafts/new-chat-box";
import { draftsAtom, draftsLoadedAtom } from "@/client/drafts/store";
import { keptAtom, keptInOtherWindows } from "@/client/lib/kept-state";
import { freshTabId } from "@/client/lib/tab-actions";
import { rpcClient } from "@/client/rpc/client";
import { type Draft, draftOfGroup, holdsSomething } from "@/shared/drafts";
import { keptTabGroupsOf, TAB_GROUPS_KEY } from "@/shared/kept-state";
import { type SidebarPlace } from "@/shared/tabs";
import { type ChatId, StoreId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useEffectEvent, useRef } from "react";

import {
  appTabsAtom,
  groupOfHref,
  INBOX_HREF,
  isSiteGroup,
  openInNewWindow,
  useAppTabs,
} from "./app-tabs";
import { chatListOptions } from "./chat-list-query";
import { type Chat, draftTitle } from "./chats";
import { isGroupScreenHref } from "./group-screen";
import {
  chatOfTab,
  chatsOfGroup,
  draftOfTab,
  groupLayoutOf,
  isHomeTab,
  selectedTabIn,
  tabsIn,
  type WindowTabs,
} from "./tab-model";
import {
  chatHref,
  chatOfGroup,
  groupHref,
  matchScreen,
  newChatHref,
  newGroupKey,
} from "./window-href";
import { newScreenId, useWindowTabs, windowTabsAtom } from "./window-tabs";

/**
 * One tab group as the sidebar lists it. An open group is named by the name
 * the person gave it (`groupNamesAtom`), else by its first chat (the left
 * side first, then strip order), else by the tab up on the side with the
 * keyboard, which its row reads; `kind` says which of those it has: a chat,
 * a new chat's draft with words in it, or tabs alone. History lists a chat
 * no window has a tab on, or a draft no tab is writing, by the key a group
 * made for it opens under. A group is `pinned` by its own pin
 * (`groupPinsAtom`).
 */
export type TabGroup =
  | {
      chat: Chat;
      group: string;
      kind: "chat";
      name?: string;
      pinned: boolean;
      title: string;
    }
  | {
      draft: Draft;
      group: string;
      kind: "draft";
      name?: string;
      pinned: boolean;
      title: string;
    }
  | {
      group: string;
      kind: "tabs";
      name?: string;
      pinned: boolean;
      title: string;
    };

/**
 * The tab groups this window has open, in its own order, by their keys. Null
 * for a window that has kept none yet, which opens none of the chats there
 * are (`startTabGroupsFromZero`).
 */
export const windowTabGroupsAtom = keptAtom<null | readonly string[]>(
  "window",
  TAB_GROUPS_KEY,
  null,
  (value) => keptTabGroupsOf(value) ?? null,
);

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

/**
 * The tab groups the other open windows have open, and the chats with a tab
 * in them; undefined until main first answers.
 */
function useTabGroupsElsewhere():
  | undefined
  | { chats: readonly string[]; groups: readonly string[] } {
  return useQuery(
    rpcClient.window.live.tabGroupsElsewhere.experimental_liveOptions(),
  ).data;
}

/** Whether a group is pinned above the line, by its own pin. */
export function isPinnedGroup(entry: TabGroup): boolean {
  return entry.pinned;
}

/** What a new chat is called by its words alone: "New chat" until it has some. */
export function draftWordsTitle(draft: Draft): string {
  return draft.words.trim() === "" ? "New chat" : draftTitle(draft.words);
}

/**
 * When something last happened in a group: in a chat, as its row tells, the
 * person's last message or the latest step, question or reply after it; in
 * a draft, its last change; in a group of tabs alone, never.
 */
export function lastActiveAt(entry: TabGroup): number {
  switch (entry.kind) {
    case "chat": {
      return Math.max(entry.chat.lastUserMessageAt, entry.chat.latest?.at ?? 0);
    }
    case "draft": {
      return entry.draft.updatedAt;
    }
    case "tabs": {
      return 0;
    }
  }
}

/**
 * Whether a draft is worth coming back to from History: a new chat's, not
 * on its way, with words or files in it.
 */
export function isWorthKeeping(draft: Draft): boolean {
  return (
    draft.chatId === undefined &&
    draft.sendingTo === undefined &&
    holdsSomething(draft)
  );
}

/** One open group, as its row lists it (see `TabGroup`). */
function openEntry(
  group: string,
  {
    byId,
    drafts,
    names,
    pins,
    state,
  }: {
    byId: ReadonlyMap<string, Chat>;
    drafts: readonly Draft[];
    names: Record<string, string>;
    pins: Record<string, true>;
    state: WindowTabs;
  },
): TabGroup {
  const name = names[group];
  const own = {
    group,
    ...(name === undefined ? {} : { name }),
    pinned: group in pins,
  };
  const chat = chatsOfGroup(state, group)
    .map((id) => byId.get(id))
    .find((entry) => entry !== undefined);
  if (chat) {
    return { ...own, chat, kind: "chat", title: name ?? chat.title };
  }
  // A new chat with words in it, the left side first, as chats are read.
  const draft = groupLayoutOf(state, group)
    .sides.flatMap((side) => side.tabs)
    .map((tab) => drafts.find((entry) => entry.id === draftOfTab(tab)))
    .find((entry) => entry !== undefined && entry.words.trim() !== "");
  if (draft) {
    return {
      ...own,
      draft,
      kind: "draft",
      title: name ?? draftWordsTitle(draft),
    };
  }
  return { ...own, kind: "tabs", title: name ?? "New chat" };
}

/**
 * The tab groups as this window lists them: its own open ones in its order;
 * the chats another open window has a tab on; and History, every other
 * chat, and every draft worth keeping (`isWorthKeeping`) no tab is writing,
 * most recently active first.
 */
export function useOpenGroups(): {
  elsewhere: TabGroup[];
  history: TabGroup[];
  open: TabGroup[];
} {
  const chats = useQuery(chatListOptions()).data ?? [];
  const drafts = useAtomValue(draftsAtom);
  const names = useAtomValue(groupNamesAtom);
  const pins = useAtomValue(groupPinsAtom);
  const state = useAtomValue(windowTabsAtom);
  const listed = useAtomValue(windowTabGroupsAtom) ?? [];
  const elsewhere = useTabGroupsElsewhere();
  const elsewhereChats = new Set(elsewhere?.chats);
  const byId = new Map<string, Chat>(chats.map((chat) => [chat.id, chat]));
  const isListed = new Set(listed);
  const listedTabs = state.tabs.filter(
    (tab) => tab.group !== undefined && isListed.has(tab.group),
  );
  const chatsHere = new Set(listedTabs.map((tab) => chatOfTab(tab)));
  const draftsHere = new Set(listedTabs.map((tab) => draftOfTab(tab)));
  const newestFirst = (list: TabGroup[]) =>
    list.toSorted((a, b) => lastActiveAt(b) - lastActiveAt(a));
  const closed = (entry: Chat): TabGroup => ({
    chat: entry,
    group: entry.id,
    kind: "chat",
    pinned: false,
    title: entry.title,
  });
  const unlisted = chats.filter((chat) => !chatsHere.has(chat.id));
  return {
    elsewhere: newestFirst(
      unlisted.filter((chat) => elsewhereChats.has(chat.id)).map(closed),
    ),
    history: newestFirst([
      ...unlisted.filter((chat) => !elsewhereChats.has(chat.id)).map(closed),
      ...drafts
        .filter((draft) => isWorthKeeping(draft) && !draftsHere.has(draft.id))
        .map(
          (draft): TabGroup => ({
            draft,
            group: draftGroupKeyOf(draft.id),
            kind: "draft",
            pinned: false,
            title: draftWordsTitle(draft),
          }),
        ),
    ]),
    open: listed.map((group) =>
      openEntry(group, { byId, drafts, names, pins, state }),
    ),
  };
}

/** The key a group made for a draft opened from History is kept under. */
function draftGroupKeyOf(draft: string): string {
  return `draft:${draft}`;
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
  const listed = [
    ...open.filter((entry) => isPinnedGroup(entry)),
    ...open.filter((entry) => !isPinnedGroup(entry)),
  ];
  const at = listed.findIndex((entry) => entry.group === from);
  if (at === -1) {
    return (direction === 1 ? listed[0] : listed.at(-1))?.group;
  }
  return listed[at + direction]?.group;
}

/**
 * The names with `group` named `name`, or with its name taken off where
 * `name` is blank, which gives the group its own title back.
 */
export function namedWith(
  names: Record<string, string>,
  group: string,
  name: string,
): Record<string, string> {
  const trimmed = name.trim();
  if (trimmed !== "") {
    return names[group] === trimmed ? names : { ...names, [group]: trimmed };
  }
  if (!(group in names)) {
    return names;
  }
  const { [group]: _cleared, ...rest } = names;
  return rest;
}

/** The pins with `group` pinned, or with its pin taken off. */
export function pinnedWith(
  pins: Record<string, true>,
  group: string,
  pinned: boolean,
): Record<string, true> {
  if (pinned) {
    return group in pins ? pins : { ...pins, [group]: true };
  }
  if (!(group in pins)) {
    return pins;
  }
  const { [group]: _unpinned, ...rest } = pins;
  return rest;
}

/**
 * A window's list as upkeep keeps it: every listed group with tabs, and each
 * with none that is given a tab here, at the address `opening` names. A
 * chat's group gets its chat's tab, as an earlier build kept a group that
 * was its chat alone. A draft's group gets its new chat while the draft is
 * there, or while the group is named or pinned, as that build kept one whose
 * chat had not started with nothing in it but its name or pin; the new chat
 * stands at the draft's address, which the window's tab may still ask for.
 * Any other group named or pinned gets a new chat. The rest leave the list,
 * so a group with a name or a pin never does.
 */
export function upkeptList(
  listed: readonly string[],
  state: WindowTabs,
  {
    drafts,
    names,
    pins,
  }: {
    drafts: readonly Draft[];
    names: Record<string, string>;
    pins: Record<string, true>;
  },
): { kept: string[]; opening: { group: string; href: string }[] } {
  const hrefFor = (group: string) => {
    const chat = chatOfGroup(group);
    if (chat !== undefined) {
      return chatHref(chat);
    }
    const isOwn = group in names || group in pins;
    const draft = draftOfGroup(group);
    if (draft !== undefined) {
      return isOwn || drafts.some((entry) => entry.id === draft)
        ? newChatHref(draft)
        : undefined;
    }
    return isOwn ? NEW_TAB_HREF : undefined;
  };
  const opening: { group: string; href: string }[] = [];
  const kept = listed.filter((group) => {
    if (tabsIn(state, group).length > 0) {
      return true;
    }
    const href = hrefFor(group);
    if (href !== undefined) {
      opening.push({ group, href });
    }
    return href !== undefined;
  });
  return { kept, opening };
}

/**
 * The pins with every listed group keyed by a starred chat's id pinned: an
 * earlier build keyed a chat's group by the chat and pinned it by the chat's
 * star, which pins nothing now.
 */
export function pinnedFromStars(
  pins: Record<string, true>,
  listed: readonly string[],
  chats: readonly Pick<Chat, "id" | "starred">[],
): Record<string, true> {
  const starred = new Set<string>(
    chats.flatMap((chat) => (chat.starred ? [chat.id] : [])),
  );
  return listed.reduce(
    (next, group) =>
      starred.has(group) ? pinnedWith(next, group, true) : next,
    pins,
  );
}

/**
 * A group's tabs as its copy starts with them, in their order and each
 * under a new id (`newId`), in `group`: a page at the address it shows,
 * with its title and icon until it loads, and a screen at its own address,
 * so a new tab stays a new tab. Neither takes its history. `up` is the
 * copy of the tab `up` names.
 */
export function copiedTabs(
  tabs: readonly WindowTab[],
  {
    group,
    newId,
    now,
    up,
  }: { group: string; newId: () => string; now: number; up?: string },
): { tabs: WindowTab[]; up: string | undefined } {
  let upCopy: string | undefined;
  const copies = tabs.map((tab): WindowTab => {
    const id = newId();
    if (tab.id === up) {
      upCopy = id;
    }
    const side = tab.side === 1 ? { side: 1 as const } : {};
    if (tab.kind === "screen") {
      return { group, href: tab.href, id, kind: "screen", ...side };
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
  return { tabs: copies, up: upCopy };
}

/** A screen tab at an address, in a group: a chat's, or a new chat's. */
function screenTab(group: string, href: string, side?: 1): WindowTab {
  return {
    group,
    href,
    id: newScreenId(),
    kind: "screen",
    ...(side === undefined ? {} : { side }),
  };
}

/**
 * What the window does with its tab groups: make one, bring one up (in the
 * window that has it open, when another does), close one and bring back a
 * chat or a draft from History, and move one to a window of its own.
 */
export function useTabGroupActions() {
  const store = useStore();
  const appTabs = useAppTabs();
  const windowTabs = useWindowTabs();
  const forgetGroup = useSetAtom(forgetGroupAtom);
  const pickProject = useSetAtom(pickNewChatProjectAtom);
  const setNames = useSetAtom(groupNamesAtom);
  const setPins = useSetAtom(groupPinsAtom);

  /** The group the window shows now, read at the call. */
  const groupUp = () => {
    const model = store.get(appTabsAtom);
    const up = model.tabs.find((tab) => tab.id === model.selectedId);
    return up === undefined ? undefined : groupOfHref(up.pathname);
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

  /**
   * A tab's group shown here with the tab up in it, the keyboard with it:
   * where a chat or a draft asked for by its address is found.
   */
  const showTab = (tab: WindowTab, options: { replace?: boolean } = {}) => {
    if (tab.group === undefined) {
      return;
    }
    showHere(tab.group, options);
    windowTabs.select(tab.id);
  };

  /**
   * Brings up a tab on a chat or a draft, asked for by its address (a link,
   * a row of History): the first tab on it in a group this window lists;
   * else, once no other window has one, the group it was last in, closed
   * since; else a group made for it, under its own key where that is free.
   */
  const showWhereTab = (
    shows: (tab: WindowTab) => boolean,
    {
      href,
      key,
      replace = false,
    }: { href: string; key: string; replace?: boolean },
  ) => {
    const state = store.get(windowTabsAtom);
    const listed = store.get(windowTabGroupsAtom) ?? [];
    const here = listed
      .flatMap((group) => tabsIn(state, group))
      .find((tab) => shows(tab));
    if (here) {
      showTab(here, { replace });
      return;
    }
    const open = () => {
      const latest = store.get(windowTabsAtom);
      const kept = latest.tabs.find(
        (tab) =>
          tab.group !== undefined &&
          shows(tab) &&
          !isListedElsewhere(tab.group) &&
          !(store.get(windowTabGroupsAtom) ?? []).includes(tab.group),
      );
      if (kept) {
        showTab(kept, { replace });
        return;
      }
      // Under its own key while no window lists that group: what a chat's
      // agent opened while no group had a tab on the chat waits there, and
      // comes up with it.
      const group =
        !isListedElsewhere(key) &&
        !(store.get(windowTabGroupsAtom) ?? []).includes(key)
          ? key
          : newGroupKey();
      const tab = screenTab(group, href);
      windowTabs.openIn(tab, { group, select: true });
      showHere(group, { replace });
    };
    void rpcClient.window.showInOtherWindow.call({ href }).then((shown) => {
      if (!shown) {
        open();
      }
    }, open);
  };

  /** Brings up a chat's tab, wherever it is (`showWhereTab`). */
  const showChat = (chat: ChatId, options: { replace?: boolean } = {}) => {
    showWhereTab((tab) => chatOfTab(tab) === chat, {
      href: chatHref(chat),
      key: chat,
      ...options,
    });
  };

  /** Brings up the new chat writing a draft, wherever it is (`showWhereTab`). */
  const showDraft = (draft: string, options: { replace?: boolean } = {}) => {
    showWhereTab((tab) => draftOfTab(tab) === draft, {
      href: newChatHref(draft),
      key: draftGroupKeyOf(draft),
      ...options,
    });
  };

  /**
   * A tab into another group, up there with the keyboard, at the end of the
   * side with it. A group the tab leaves with nothing closes.
   */
  const moveTab = (id: string, group: string) => {
    const state = store.get(windowTabsAtom);
    const tab = state.tabs.find((entry) => entry.id === id);
    windowTabs.moveTo({
      group,
      id,
      select: true,
      side: groupLayoutOf(state, group).focused,
    });
    const from = tab?.group;
    if (from !== undefined && from !== group) {
      const left = tabsIn(state, from).filter((entry) => entry.id !== id);
      if (left.length === 0) {
        setListed((list) => listedWithout(list, from));
        forgetGroup(from);
      }
    }
  };

  /**
   * A new group at the top of the list, under New, or at a place in it,
   * pinned there when the place is among the pinned rows: one side with a
   * new chat in it, filed under a project when one is named, unless
   * something else is to open in it.
   */
  const make = ({
    fill,
    href,
    isShownHere = true,
    moving,
    place,
    projectId,
  }: {
    /** Opens what the group starts with. */
    fill?: (group: string) => void;
    /** A screen the group starts on, as a tab. */
    href?: string;
    /** Whether this window comes up on it: not for one a window of its own is opening on. */
    isShownHere?: boolean;
    /** A tab to move into the new group in place of opening one. */
    moving?: string;
    /** Where it goes in the list, when not at the top. */
    place?: SidebarPlace;
    projectId?: string;
  } = {}) => {
    const group = newGroupKey();
    if (isShownHere) {
      setListed((list) => listedWith(list, group, place));
    }
    if (place?.pinned === true) {
      setPins((pins) => pinnedWith(pins, group, true));
    }
    if (fill) {
      fill(group);
    } else if (moving !== undefined) {
      moveTab(moving, group);
    } else {
      const tab = screenTab(group, href ?? NEW_TAB_HREF);
      windowTabs.openIn(tab, { group, select: true });
      if (href === undefined && projectId !== undefined) {
        pickProject({ projectId, tabId: tab.id });
      }
    }
    if (isShownHere) {
      // From a screen or page that is no tab group's, the new group takes its place.
      const up = groupUp();
      appTabs.navigate(groupHref(group), {
        replace: up === undefined || isSiteGroup(up),
      });
    }
    return group;
  };

  /**
   * A copy of a group just below it, up in this window: its tabs copied
   * (`copiedTabs`) on the same sides, the same one up, named and pinned as
   * the group is. A chat's tab copied is another tab on the same chat.
   */
  const duplicate = (entry: TabGroup) => {
    const tabs = store.get(windowTabsAtom);
    const name = store.get(groupNamesAtom)[entry.group];
    const copy = make({
      fill: (group) => {
        const copied = copiedTabs(tabsIn(tabs, entry.group), {
          group,
          newId: () => StoreId.newTabId(),
          now: Date.now(),
          up: selectedTabIn(tabs, entry.group)?.id,
        });
        windowTabs.restoreGroup(group, copied.tabs);
        if (copied.up !== undefined) {
          windowTabs.select(copied.up);
        }
      },
      place: { after: entry.group },
    });
    if (name !== undefined) {
      setNames((names) => namedWith(names, copy, name));
    }
    if (isPinnedGroup(entry)) {
      setPins((pins) => pinnedWith(pins, copy, true));
    }
  };

  /** The group to show once `group` is gone: the one after it in the list, else the one before, else a new one. */
  const neighborOf = (group: string, list: readonly TabGroup[]) => {
    const index = list.findIndex((entry) => entry.group === group);
    const rest = list.filter((entry) => entry.group !== group);
    return rest[Math.min(Math.max(index, 0), rest.length - 1)]?.group;
  };

  /**
   * Closes a group: it leaves this window's list, and its chats and drafts
   * go to History. Its tabs are kept for a chat of it opened again from
   * there, which brings the group back as it was, unless it has nothing to
   * come back to: only new chats nobody has written in. The window moves on
   * to the next group when it was showing this one.
   */
  const close = (group: string, list: readonly TabGroup[]) => {
    unlist(group);
    moveOff(group, list);
  };

  /** A group off this window's list as `close` takes it. */
  const unlist = (group: string) => {
    setListed((listed) => listedWithout(listed, group));
    const tabs = tabsIn(store.get(windowTabsAtom), group);
    if (tabs.every((tab) => isHomeTab(tab))) {
      windowTabs.dropGroup(group);
      forgetGroup(group);
    }
  };

  /**
   * Closes several groups at once, each as `close` does, the way a row's
   * menu closes the rows around it: when the window was showing one of
   * them, it moves to `keep`, the group whose menu asked.
   */
  const closeAll = (groups: readonly string[], keep: string) => {
    const up = groupUp();
    for (const group of groups) {
      unlist(group);
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

  /** A group off this window's list and into a window of its own, which has it open from then on. */
  const moveToNewWindow = (group: string, list: readonly TabGroup[]) => {
    letGo(group, list);
    openInNewWindow(groupHref(group));
  };

  /** Pins a group above the line, or takes it back down, by its own pin. */
  const pin = (group: string, pinned: boolean) => {
    setPins((pins) => pinnedWith(pins, group, pinned));
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

  /** Opens a chat or a draft from History or the search, or brings up the group it is in. */
  const restore = (entry: TabGroup) => {
    switch (entry.kind) {
      case "chat": {
        showChat(entry.chat.id);
        return;
      }
      case "draft": {
        showDraft(entry.draft.id);
        return;
      }
      case "tabs": {
        show(entry.group);
      }
    }
  };

  /**
   * A new chat in a group, up at once with the keyboard: right after the
   * tab up on the side with the keyboard. In a new group when none is up.
   */
  const newTab = (group = groupUp()) => {
    if (group === undefined) {
      make();
      return;
    }
    windowTabs.openScreen(NEW_TAB_HREF, {
      ...(selectedTabIn(store.get(windowTabsAtom), group)?.id === undefined
        ? {}
        : { after: selectedTabIn(store.get(windowTabsAtom), group)?.id }),
      group,
      select: true,
    });
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
    letGo,
    make,
    moveOff,
    moveTab,
    moveToNewWindow,
    newTab,
    pin,
    place,
    restore,
    show,
    showChat,
    showDraft,
    showHere,
  };
}

/**
 * Keeps what the window's one app tab stands on a tab group of this
 * window's list. A group the tab came to some other way than through the
 * list (a step back) joins it at the top. A chat's or a draft's address
 * asks for the group with its tab, which the tab moves to (`showChat`). A
 * listed group with no tabs, as an earlier build kept a group that was its
 * chat alone, gets its chat's tab, or its draft's; one with neither leaves
 * the list. Everything else sits inside a group too: a screen or a page the
 * app tab came to on its own becomes a tab of the group last up, or of a
 * new group, and the inbox shows the group last up, or the first, or a new
 * one. Groups another window has open too leave this one's list once, as
 * it opens, unless this window is showing them: a window closed with them
 * and brought back since they were opened elsewhere. None of this happens
 * until main has read the drafts, since a draft missing before then may
 * only be unread.
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
    if (!draftsLoaded) {
      return;
    }
    const listed = store.get(windowTabGroupsAtom) ?? [];
    const state = store.get(windowTabsAtom);
    const { kept, opening } = upkeptList(listed, state, {
      drafts: store.get(draftsAtom),
      names: store.get(groupNamesAtom),
      pins: store.get(groupPinsAtom),
    });
    for (const { group, href: tabHref } of opening) {
      windowTabs.openIn(screenTab(group, tabHref), { group, select: true });
    }
    if (kept.length !== listed.length) {
      store.set(windowTabGroupsAtom, kept);
    }
    const screen = matchScreen(href);
    // A chat or a draft asked for by its address, once per ask.
    if (screen.kind === "chat" || (screen.kind === "inbox" && screen.draft)) {
      if (asked.current === href) {
        return;
      }
      asked.current = href;
      if (screen.kind === "chat") {
        groups.showChat(screen.chat, { replace: true });
      } else if (screen.draft !== undefined) {
        groups.showDraft(screen.draft, { replace: true });
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
      return;
    }
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
      (group) => group === up || !elsewhere.groups.includes(group),
    );
    if (listed && kept && kept.length !== listed.length) {
      store.set(windowTabGroupsAtom, kept);
    }
  }, [elsewhere, href, store]);

  // Once, as the chats first come in: every window's listed groups an
  // earlier build pinned by their chat's star get a pin of their own.
  const chats = useQuery(chatListOptions()).data;
  const carryStarPins = useEffectEvent((list: readonly Chat[]) => {
    if (store.get(starPinsCarriedAtom)) {
      return;
    }
    store.set(starPinsCarriedAtom, true);
    const listed = [
      ...(store.get(windowTabGroupsAtom) ?? []),
      ...keptInOtherWindows(TAB_GROUPS_KEY).flatMap(
        (kept) => keptTabGroupsOf(kept) ?? [],
      ),
    ];
    store.set(groupPinsAtom, (pins) => pinnedFromStars(pins, listed, list));
  });
  useEffect(() => {
    if (chats !== undefined) {
      carryStarPins(chats);
    }
  }, [chats]);
}
