import { NEW_TAB_HREF } from "@/client/atoms/window";
import { chatClosedByGroupAtom } from "@/client/atoms/tab-groups";
import {
  createDraftAtom,
  draftsAtom,
  removeDraftAtom,
  updateDraftAtom,
} from "@/client/drafts/store";
import { keptInOtherWindows } from "@/client/lib/kept-state";
import { TabsModelSchema } from "@/shared/tabs";
import { rpcClient } from "@/client/rpc/client";
import {
  type Draft,
  draftGroupOf,
  draftOfGroup,
  holdsSomething,
  isLeftEmpty,
} from "@/shared/drafts";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { ulid } from "ulid";

import { APP_TABS_KEY } from "@/shared/kept-state";
import { appTabsAtom, groupOfHref, useAppTabs } from "./app-tabs";
import { setArchived } from "./chat-actions";
import { bandTabLines, lineKeyOf } from "./context-items";
import { chatListOptions } from "./chat-list-query";
import { type Chat, draftTitle } from "./chats";
import { chatHref, chatOfGroup, newChatHref } from "./window-href";
import { useWindowTabs, windowTabsAtom } from "./window-tabs";

/**
 * One tab group as the sidebar lists it: a chat with its tabs, or a draft
 * whose chat has not started yet, with the tabs gathered beside it.
 */
export type TabGroup =
  | { chat: Chat; group: ChatId; kind: "chat"; title: string }
  | { draft: Draft; group: string; kind: "draft"; title: string };

/** The drafts that are groups: a new chat's, not a reply waiting in a chat's box and not one being sent, holding words or tabs. */
function draftGroups(
  drafts: readonly Draft[],
  hasTabs: (group: string) => boolean,
): TabGroup[] {
  return drafts.flatMap((draft): TabGroup[] => {
    const group = draftGroupOf(draft.id);
    if (
      draft.chatId !== undefined ||
      draft.sendingTo !== undefined ||
      (!holdsSomething(draft) && !hasTabs(group))
    ) {
      return [];
    }
    return [
      {
        draft,
        group,
        kind: "draft",
        title: draft.words.trim() === "" ? "New tab" : draftTitle(draft.words),
      },
    ];
  });
}

/** Every open group, in the order the sidebar lists them: chats as the list has them, oldest first, then drafts by when they began. */
export function useOpenGroups(): { closed: TabGroup[]; open: TabGroup[] } {
  const chats = useQuery(chatListOptions()).data ?? [];
  const drafts = useAtomValue(draftsAtom);
  const { allTabs } = useWindowTabs();
  const grouped = new Set(
    allTabs.flatMap((tab) => (tab.group === undefined ? [] : [tab.group])),
  );
  const asGroup = (chat: Chat): TabGroup => ({
    chat,
    group: chat.id,
    kind: "chat",
    title: chat.title,
  });
  return {
    closed: chats.filter((chat) => chat.archived).map(asGroup),
    open: [
      ...chats.filter((chat) => !chat.archived).map(asGroup),
      ...draftGroups(
        [...drafts].sort((a, b) => a.createdAt - b.createdAt),
        (group) => grouped.has(group),
      ),
    ],
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
 * window that already shows it, when another does), close one to History
 * and bring one back.
 */
export function useTabGroupActions() {
  const store = useStore();
  const queryClient = useQueryClient();
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

  /** Brings a group up here, or the window that shows it forward. */
  const show = (group: string) => {
    const href = groupHref(group);
    const elsewhere = keptInOtherWindows(APP_TABS_KEY).some((kept) => {
      const model = TabsModelSchema.safeParse(kept).data;
      const up = model?.tabs.find((tab) => tab.id === model.selectedId);
      return up !== undefined && groupOfHref(up.pathname) === group;
    });
    if (!elsewhere) {
      appTabs.navigate(href);
      return;
    }
    void rpcClient.window.showInOtherWindow.call({ href }).then((shown) => {
      if (!shown) {
        appTabs.navigate(href);
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
      windowTabs.dropGroup(tab.group);
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
    if (fill) {
      fill(group);
    } else if (moving === undefined) {
      windowTabs.openScreen(href, { group, select: true });
    } else {
      moveTab(moving, group);
    }
    if (isShownHere) {
      appTabs.navigate(newChatHref(id));
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
   * Closes a group to History: a chat is archived, with its tabs kept for
   * when it comes back; a draft has no History, so it goes. The window moves
   * on to the next group when it was showing this one.
   */
  const close = (group: string, list: readonly TabGroup[]) => {
    const chat = chatOfGroup(group);
    if (chat !== undefined) {
      setArchived(queryClient, { id: chat }, true);
    } else {
      const draft = draftOfGroup(group);
      windowTabs.dropGroup(group);
      if (draft !== undefined) {
        void removeDraft(draft);
      }
    }
    moveOff(group, list);
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

  /** Brings a closed group back from History and shows it. */
  const restore = (chat: ChatId) => {
    setArchived(queryClient, { id: chat }, false);
    show(chat);
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
    close,
    groupUp,
    hasTabs,
    make,
    moveOff,
    moveTab,
    newTab,
    restore,
    setChatOpen,
    show,
  };
}
