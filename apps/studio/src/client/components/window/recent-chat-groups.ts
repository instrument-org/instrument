import { type WindowTab } from "@/client/atoms/window";
import { readKept } from "@/client/lib/kept-state";
import { rpcClient } from "@/client/rpc/client";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "jotai";
import { useEffect, useEffectEvent, useRef } from "react";
import { z } from "zod";

import { appTabsAtom } from "./app-tabs";
import { chatListOptions } from "./chat-list-query";
import { byLastUserMessage, type Chat, type Project } from "./chats";
import { windowTabGroupsAtom } from "./open-groups";
import { chatOfTab, closedTabsOf } from "./tab-model";
import { chatHref, matchScreen, newGroupKey } from "./window-href";
import { newScreenId, useWindowTabs, windowTabsAtom } from "./window-tabs";

/** How long since the person last wrote in a chat for it to open. */
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;
/** The most chats that open at the sidebar's root. */
const MOST_AT_ROOT = 5;
/** The most that open in each project. */
const MOST_IN_PROJECT = 3;

/** Where a 2.0 build kept each chat's tabs beside it, by the chat's id. */
const EARLIER_TABS_KEY = "window-tabs.v10";
/** Where a 2.0 build kept whether each chat's side was showing; one never toggled showed. */
const EARLIER_SIDE_OPEN_KEY = "pane-open.v2";

const EarlierTabsSchema = z.object({
  active: z.string().optional(),
  tabs: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        favicon: z.string().optional(),
        id: z.string(),
        kind: z.literal("page"),
        openedUrl: z.string().optional(),
        title: z.string().optional(),
        url: z.string().optional(),
      }),
      z.object({
        href: z.string(),
        id: z.string(),
        kind: z.literal("screen"),
      }),
    ]),
  ),
});

/** A chat to open as a tab group, in a live project's list or the root's. */
interface RecentChat {
  chat: ChatId;
  project: string | undefined;
}

/**
 * The chats that open as tab groups the first time a workspace comes up with
 * them, newest first as the chat list orders them: the ones the person wrote
 * in lately, a few at the root and a few in each project. None archived, with
 * a tab already, or closed here, and none written in since the window loaded,
 * which no earlier build left: the chat a new tab just started is listed
 * before that tab is turned to it.
 */
export function recentChatsToOpen(
  chats: readonly Chat[],
  {
    loadedAt,
    now,
    projects,
    skip,
  }: {
    /** When the window's page loaded. */
    loadedAt: number;
    now: number;
    projects: readonly Pick<Project, "id" | "retired">[];
    /** The chats with a tab in some group, or on the closed list. */
    skip: ReadonlySet<ChatId>;
  },
): RecentChat[] {
  const live = new Set(
    projects.flatMap((project) => (project.retired ? [] : [project.id])),
  );
  const counts = new Map<string | undefined, number>();
  return byLastUserMessage(
    chats.filter(
      (chat) =>
        !chat.archived &&
        chat.lastUserMessageAt < loadedAt &&
        now - chat.lastUserMessageAt <= RECENT_MS,
    ),
  ).flatMap((chat): RecentChat[] => {
    const project =
      chat.project !== undefined && live.has(chat.project)
        ? chat.project
        : undefined;
    const count = counts.get(project) ?? 0;
    if (count >= (project === undefined ? MOST_AT_ROOT : MOST_IN_PROJECT)) {
      return [];
    }
    // One open already is one of the few.
    counts.set(project, count + 1);
    return skip.has(chat.id) ? [] : [{ chat: chat.id, project }];
  });
}

/**
 * A chat's group as it opens: the chat on the left with the keyboard, and
 * on the right what a 2.0 build showed beside it, each tab at its address
 * under a new id. A side that was hidden, or had nothing up, does not open.
 */
export function chatGroupTabs(
  chat: ChatId,
  {
    earlier,
    group,
    isSideOpen,
    newId,
    now,
  }: {
    /** The chat's tabs as a 2.0 build kept them. */
    earlier: unknown;
    group: string;
    isSideOpen: boolean;
    newId: () => string;
    now: number;
  },
): { beside: number | undefined; tabs: WindowTab[] } {
  const tabs: WindowTab[] = [
    { group, href: chatHref(chat), id: newId(), kind: "screen" },
  ];
  const kept = EarlierTabsSchema.safeParse(earlier).data;
  if (
    !isSideOpen ||
    !kept ||
    !kept.tabs.some((tab) => tab.id === kept.active)
  ) {
    return { beside: undefined, tabs };
  }
  let beside: number | undefined;
  for (const tab of kept.tabs) {
    const own = { group, id: newId(), side: 1 as const };
    if (tab.kind === "screen") {
      if (!opensBeside(tab.href)) {
        continue;
      }
      tabs.push({ ...own, href: tab.href, kind: "screen" });
    } else {
      const url = tab.url ?? tab.openedUrl;
      if (url === undefined) {
        continue;
      }
      tabs.push({
        ...own,
        ...(tab.favicon === undefined ? {} : { favicon: tab.favicon }),
        kind: "page",
        openedAt: now,
        openedUrl: url,
        ...(tab.title === undefined ? {} : { title: tab.title }),
        url,
      });
    }
    if (tab.id === kept.active) {
      beside = tabs.length - 1;
    }
  }
  return { beside: beside ?? (tabs.length > 1 ? 1 : undefined), tabs };
}

/** Whether a 2.0 screen is something to bring back beside its chat: not a new tab, or an address this build has no screen for. */
function opensBeside(href: string): boolean {
  switch (matchScreen(href).kind) {
    case "activity":
    case "app":
    case "apps":
    case "computer":
    case "settings":
    case "task": {
      return true;
    }
    default: {
      return false;
    }
  }
}

/**
 * Opens the person's recent chats as tab groups, once in a workspace's life
 * on this computer, so a build with tab groups does not come up empty over
 * chats a build without them left. They go under the groups the window has,
 * and the window goes on showing what it shows. Main says which window opens
 * them, once there are chats to open.
 */
export function useOpenRecentChats({
  projects,
}: {
  /** The projects, undefined until they are read. */
  projects: readonly Project[] | undefined;
}) {
  const store = useStore();
  const windowTabs = useWindowTabs();
  const { data: chats } = useQuery(chatListOptions());
  const isAsked = useRef(false);

  const open = useEffectEvent(() => {
    if (!chats || !projects) {
      return;
    }
    const now = Date.now();
    const closed = store.get(appTabsAtom).recentlyClosed.flatMap(closedTabsOf);
    const skip = new Set(
      [...store.get(windowTabsAtom).tabs, ...closed].flatMap(
        (tab) => chatOfTab(tab) ?? [],
      ),
    );
    const sides = z
      .record(z.string(), z.unknown())
      .safeParse(readKept("layout", EARLIER_SIDE_OPEN_KEY)).data;
    const groups = recentChatsToOpen(chats, {
      loadedAt: performance.timeOrigin,
      now,
      projects,
      skip,
    }).map(({ chat, project }) => {
      const group = newGroupKey();
      const { beside, tabs } = chatGroupTabs(chat, {
        earlier: readKept("layout", `${EARLIER_TABS_KEY}/${chat}`),
        group,
        isSideOpen: sides?.[chat] !== false,
        newId: newScreenId,
        now,
      });
      windowTabs.restoreGroup(group, tabs, {
        active: 0,
        ...(beside === undefined ? {} : { beside }),
      });
      windowTabs.setGroupOwn(group, project === undefined ? {} : { project });
      return group;
    });
    store.set(windowTabGroupsAtom, (listed) => [...(listed ?? []), ...groups]);
  });

  const isReady =
    chats !== undefined && chats.length > 0 && projects !== undefined;
  useEffect(() => {
    if (!isReady || isAsked.current) {
      return;
    }
    isAsked.current = true;
    void rpcClient.window.takeRecentChats.call().then((isOurs) => {
      if (isOurs) {
        open();
      }
    });
  }, [isReady]);
}
