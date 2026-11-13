import { NEW_TAB_HREF } from "@/client/atoms/window";
import { chatClosedByGroupAtom } from "@/client/atoms/tab-groups";
import {
  createDraftAtom,
  draftsAtom,
  removeDraftAtom,
  updateDraftAtom,
} from "@/client/drafts/store";
import { keptAtom, keptInOtherWindows } from "@/client/lib/kept-state";
import { freshTabId } from "@/client/lib/tab-actions";
import { rpcClient } from "@/client/rpc/client";
import {
  type Draft,
  draftGroupOf,
  draftOfGroup,
  holdsSomething,
  isLeftEmpty,
} from "@/shared/drafts";
import { keptTabGroupsOf, TAB_GROUPS_KEY } from "@/shared/kept-state";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useEffectEvent, useRef } from "react";
import { ulid } from "ulid";

import {
  appTabsAtom,
  groupOfHref,
  INBOX_HREF,
  isSiteGroup,
  openInNewWindow,
  useAppTabs,
} from "./app-tabs";
import { bandTabLines, lineKeyOf } from "./context-items";
import { chatListOptions } from "./chat-list-query";
import { type Chat, draftTitle } from "./chats";
import { isGroupScreenHref } from "./group-screen";
import { chatHref, matchScreen, newChatHref } from "./window-href";
import { useWindowTabs, windowTabsAtom } from "./window-tabs";

/**
 * One tab group as the sidebar lists it: a chat with its tabs, or a draft
 * whose chat has not started yet, with the tabs gathered beside it.
 */
export type TabGroup =
  | { chat: Chat; group: ChatId; kind: "chat"; title: string }
  | { draft: Draft; group: string; kind: "draft"; title: string };

/**
 * The tab groups this window has open, in its own order: a chat's id, or a
 * draft's group for a chat not started yet. Null for a window that has kept
 * none yet, which opens none of the chats there are (`startTabGroupsFromZero`).
 */
export const windowTabGroupsAtom = keptAtom<null | readonly string[]>(
  "window",
  TAB_GROUPS_KEY,
  null,
  (value) => keptTabGroupsOf(value) ?? null,
);

/** A window's groups with one more at the bottom, unless it has it already. */
export function listedWith(
  list: null | readonly string[],
  group: string,
): string[] {
  const listed = list ?? [];
  return listed.includes(group) ? [...listed] : [...listed, group];
}

/** A window's groups without one. */
export function listedWithout(
  list: null | readonly string[],
  group: string,
): string[] {
  return (list ?? []).filter((entry) => entry !== group);
}

/** A window's groups with `to` in `from`'s place, or `from` gone where `to` is listed already. */
export function listedReplacing(
  list: null | readonly string[],
  from: string,
  to: string,
): string[] {
  const listed = list ?? [];
  if (listed.includes(to)) {
    return listedWithout(listed, from);
  }
  return listed.includes(from)
    ? listed.map((entry) => (entry === from ? to : entry))
    : [...listed, to];
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

/** The tab groups the other open windows have open; undefined until main first answers. */
function useTabGroupsElsewhere(): readonly string[] | undefined {
  return useQuery(
    rpcClient.window.live.tabGroupsElsewhere.experimental_liveOptions(),
  ).data;
}

/** A group whose chat has not started, as the sidebar lists it. */
function draftGroup(draft: Draft): TabGroup {
  return {
    draft,
    group: draftGroupOf(draft.id),
    kind: "draft",
    title: draft.words.trim() === "" ? "New tab" : draftTitle(draft.words),
  };
}

/**
 * When something last happened in a group: in a chat, as its row tells, the
 * person's last message or the latest step, question or reply after it; in
 * a draft, its last change.
 */
export function lastActiveAt(entry: TabGroup): number {
  return entry.kind === "chat"
    ? Math.max(entry.chat.lastUserMessageAt, entry.chat.latest?.at ?? 0)
    : entry.draft.updatedAt;
}

/** A new chat's draft that is worth coming back to: not a reply in a chat's box, not on its way, and holding words or files. */
function isKeptDraft(draft: Draft): boolean {
  return (
    draft.chatId === undefined &&
    draft.sendingTo === undefined &&
    holdsSomething(draft)
  );
}

function chatGroup(chat: Chat): TabGroup {
  return { chat, group: chat.id, kind: "chat", title: chat.title };
}

/**
 * The tab groups as this window lists them: its own open ones in its order,
 * the ones other open windows have open, and History, every other chat and
 * every other draft with words or files in it, most recently active first.
 */
export function useOpenGroups(): {
  elsewhere: TabGroup[];
  history: TabGroup[];
  open: TabGroup[];
} {
  const chats = useQuery(chatListOptions()).data ?? [];
  const drafts = useAtomValue(draftsAtom);
  const listed = useAtomValue(windowTabGroupsAtom) ?? [];
  const elsewhereGroups = new Set(useTabGroupsElsewhere());
  const byId = new Map<string, Chat>(chats.map((chat) => [chat.id, chat]));
  const isListed = new Set(listed);
  const unlisted = [
    ...chats.map(chatGroup),
    ...drafts.filter(isKeptDraft).map(draftGroup),
  ].filter((entry) => !isListed.has(entry.group));
  const newestFirst = (list: TabGroup[]) =>
    list.toSorted((a, b) => lastActiveAt(b) - lastActiveAt(a));
  return {
    elsewhere: newestFirst(
      unlisted.filter((entry) => elsewhereGroups.has(entry.group)),
    ),
    history: newestFirst(
      unlisted.filter((entry) => !elsewhereGroups.has(entry.group)),
    ),
    open: listed.flatMap((group): TabGroup[] => {
      const draftId = draftOfGroup(group);
      if (draftId === undefined) {
        const chat = byId.get(group);
        return chat ? [chatGroup(chat)] : [];
      }
      const draft = drafts.find((entry) => entry.id === draftId);
      return draft ? [draftGroup(draft)] : [];
    }),
  };
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
  const isPinned = (entry: TabGroup) =>
    entry.kind === "chat" && entry.chat.starred;
  const listed = [
    ...open.filter((entry) => isPinned(entry)),
    ...open.filter((entry) => !isPinned(entry)),
  ];
  const at = listed.findIndex((entry) => entry.group === from);
  if (at === -1) {
    return (direction === 1 ? listed[0] : listed.at(-1))?.group;
  }
  return listed[at + direction]?.group;
}

/** The address a group stands on in the window's one app tab. */
export function groupHref(group: string): string {
  const draft = draftOfGroup(group);
  return draft === undefined ? chatHref(group as ChatId) : newChatHref(draft);
}

/**
 * What the window does with its tab groups: make one, bring one up (in the
 * window that has it open, when another does), close one to History and
 * bring one back, and move one to a window of its own.
 */
export function useTabGroupActions() {
  const store = useStore();
  const appTabs = useAppTabs();
  const windowTabs = useWindowTabs();
  const createDraft = useSetAtom(createDraftAtom);
  const removeDraft = useSetAtom(removeDraftAtom);
  const updateDraft = useSetAtom(updateDraftAtom);
  const setChatClosed = useSetAtom(chatClosedByGroupAtom);

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

  /** Brings a group up here, at the bottom of the list when it was not open here. */
  const showHere = (group: string) => {
    setListed((list) => listedWith(list, group));
    appTabs.navigate(groupHref(group));
  };

  /**
   * Brings a group up: here when it is open here or in no other window, and
   * otherwise in the window that has it open, which comes forward, since a
   * group is open in one window at a time.
   */
  const show = (group: string) => {
    if (store.get(windowTabGroupsAtom)?.includes(group)) {
      appTabs.navigate(groupHref(group));
      return;
    }
    // Closed windows that can come back are among these; main looks only
    // at the open ones, and says no for the rest.
    const isElsewhere = keptInOtherWindows(TAB_GROUPS_KEY).some((kept) =>
      keptTabGroupsOf(kept)?.includes(group),
    );
    if (!isElsewhere) {
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
   * A tab into another group, up there. A draft's tabs are also lines of its
   * `context`, which open again as tabs wherever the draft is shown, so the
   * lines the tab stands for leave the draft with it.
   */
  const moveTab = (id: string, group: string) => {
    const tab = windowTabs.allTabs.find((entry) => entry.id === id);
    const draft = store
      .get(draftsAtom)
      .find((entry) => entry.id === draftOfGroup(tab?.group));
    windowTabs.moveToGroup(id, group);
    windowTabs.select(id);
    if (!tab || !draft) {
      return;
    }
    const gone = new Set(
      bandTabLines(tab, { finderOf: () => null, held: [] }).map(lineKeyOf),
    );
    const left = {
      ...draft,
      context: draft.context?.filter((line) => !gone.has(lineKeyOf(line))),
    };
    // A draft the tab leaves with nothing is thrown away, as an emptied one is.
    const hasTabs = windowTabs.allTabs.some(
      (entry) => entry.group === tab.group && entry.id !== id,
    );
    if (isLeftEmpty(left, { hasTabs }) && tab.group !== undefined) {
      const { group: emptied } = tab;
      setListed((list) => listedWithout(list, emptied));
      windowTabs.dropGroup(emptied);
      void removeDraft(draft.id);
      return;
    }
    updateDraft({ id: draft.id, update: () => left });
  };

  /**
   * A new group at the bottom of the list, on a new tab unless something
   * else is to open in it, filed under a project when one is named.
   */
  const make = ({
    fill,
    href = NEW_TAB_HREF,
    isShownHere = true,
    moving,
    projectId,
  }: {
    /** Opens what the group starts with, in place of a new tab. */
    fill?: (group: string) => void;
    href?: string;
    /** Whether this window comes up on it: not for one a window of its own is opening on. */
    isShownHere?: boolean;
    /** A tab to move into the new group in place of opening one. */
    moving?: string;
    projectId?: string;
  } = {}) => {
    const now = Date.now();
    const id = ulid();
    createDraft({
      createdAt: now,
      id,
      ...(projectId === undefined
        ? {}
        : { projectId, projectSource: "chosen" as const }),
      updatedAt: now,
      words: "",
    });
    const group = draftGroupOf(id);
    if (isShownHere) {
      setListed((list) => listedWith(list, group));
    }
    if (fill) {
      fill(group);
    } else if (moving === undefined) {
      windowTabs.openScreen(href, { group, select: true });
    } else {
      moveTab(moving, group);
    }
    if (isShownHere) {
      // From a screen or page that is no tab group's, the new group takes its place.
      const up = groupUp();
      appTabs.navigate(newChatHref(id), {
        replace: up === undefined || isSiteGroup(up),
      });
    }
    return group;
  };

  /** The group to show once `group` is gone: the one after it in the list, else the one before, else a new one. */
  const neighborOf = (group: string, list: readonly TabGroup[]) => {
    const index = list.findIndex((entry) => entry.group === group);
    const rest = list.filter((entry) => entry.group !== group);
    return rest[Math.min(Math.max(index, 0), rest.length - 1)]?.group;
  };

  /**
   * Closes a group to History: it leaves this window's list with its tabs
   * kept for when it is opened again and nothing about it changed, a chat's
   * and a draft's with words or files alike, whose file and folder stay in
   * Drafts. A draft with nothing in it has nothing to come back to, so it
   * goes. The window moves on to the next group when it was showing this one.
   */
  const close = (group: string, list: readonly TabGroup[]) => {
    setListed((listed) => listedWithout(listed, group));
    const draftId = draftOfGroup(group);
    const draft = store.get(draftsAtom).find((entry) => entry.id === draftId);
    if (draftId !== undefined && !(draft && holdsSomething(draft))) {
      windowTabs.dropGroup(group);
      void removeDraft(draftId);
    }
    moveOff(group, list);
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

  /** A draft's group becomes its chat's, in the same place in the list. */
  const becomeChat = (draftId: string, chat: ChatId) => {
    setListed((list) => listedReplacing(list, draftGroupOf(draftId), chat));
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

  /** Opens a chat or a draft from History or the search, at the bottom of the list, or brings forward the window that has it open. */
  const restore = (group: string) => {
    show(group);
  };

  /** A new tab in a group, up at once: the group up, or a new group when none is. */
  const newTab = (group = groupUp()) => {
    if (group === undefined) {
      make();
      return;
    }
    windowTabs.openScreen(NEW_TAB_HREF, { group, select: true });
  };

  /** Opens or closes a group's chat column. */
  const setChatOpen = (group: string, isOpen: boolean) => {
    setChatClosed((current) => ({ ...current, [group]: !isOpen }));
  };

  /** Whether a group has tabs, read now. */
  const hasTabs = (group: string) =>
    store.get(windowTabsAtom).tabs.some((tab) => tab.group === group);

  return {
    becomeChat,
    close,
    groupUp,
    hasTabs,
    letGo,
    make,
    moveOff,
    moveTab,
    moveToNewWindow,
    newTab,
    restore,
    setChatOpen,
    show,
  };
}

/**
 * Keeps what the window's one app tab stands on a tab group of this
 * window's list. A group the tab came to some other way than through the
 * list (a link to a chat, a step back) joins it at the bottom; one whose
 * chat had not started and whose draft has gone (swept at launch) leaves it.
 * Everything else sits inside a group too: a screen or a page the app tab
 * came to on its own becomes a tab of the group last up, or of a new group,
 * and the inbox shows the group last up, or the first, or a new one. Groups
 * another window has open too leave this one's list once, as it opens,
 * unless this window is showing them: a window closed with them and brought
 * back since they were opened elsewhere.
 */
export function useTabGroupUpkeep(href: string, open: readonly TabGroup[]) {
  const store = useStore();
  const appTabs = useAppTabs();
  const windowTabs = useWindowTabs();
  const groups = useTabGroupActions();
  const drafts = useAtomValue(draftsAtom);
  const elsewhere = useTabGroupsElsewhere();
  const lastUp = useRef<string>(undefined);

  const keep = useEffectEvent(() => {
    const isGone = (group: string) => {
      const draft = draftOfGroup(group);
      return (
        draft !== undefined &&
        !store.get(draftsAtom).some((entry) => entry.id === draft) &&
        !groups.hasTabs(group)
      );
    };
    const listed = store.get(windowTabGroupsAtom) ?? [];
    const kept = listed.filter((group) => !isGone(group));
    if (kept.length !== listed.length) {
      store.set(windowTabGroupsAtom, kept);
    }
    const group = groupOfHref(href);
    if (group !== undefined && !isSiteGroup(group)) {
      if (isGone(group)) {
        groups.moveOff(group, open);
        return;
      }
      if (!kept.includes(group)) {
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
    const screen = matchScreen(href);
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
          windowTabs.moveToGroup(tab.id, target);
        }
        const [first] = pages;
        if (first) {
          windowTabs.select(first.id);
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
  }, [href, drafts]);

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
