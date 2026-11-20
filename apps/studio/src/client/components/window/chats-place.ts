import { CHATS_PLACE_GROUP } from "@/shared/kept-state";
import { type ChatId } from "@instrument-org/workspace/client";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useStore } from "jotai";
import { createContext, use } from "react";

import { appTabsAtom, useAppTabs } from "./app-tabs";
import { chatListOptions } from "./chat-list-query";
import { byLastUserMessage, type Chat } from "./chats";
import { selectedTabIn } from "./tab-model";
import {
  CHATS_INDEX_HREF,
  chatHref,
  chatOfHref,
  groupHref,
  matchScreen,
  sameHref,
} from "./window-href";
import { newScreenId, useWindowTabs, windowTabsAtom } from "./window-tabs";

/**
 * The window's address while Chats is its place: everything right of the
 * sidebar is the chat list beside the chat picked in it, and no group is up
 * (`groupOfHref` reads no group off it).
 */
export const CHATS_PLACE_HREF = groupHref(CHATS_PLACE_GROUP);

/** Whether the window's address is the Chats place. */
export function isChatsPlaceHref(href: string): boolean {
  const screen = matchScreen(href);
  return screen.kind === "group" && screen.group === CHATS_PLACE_GROUP;
}

/**
 * The chat the place shows when it has none to keep: the first in the
 * inbox (every chat not archived) as the list orders it, but `except`, or
 * the Chats page where the inbox has no other.
 */
export function firstChatHref(
  chats: readonly Pick<Chat, "archived" | "id" | "lastUserMessageAt">[],
  except?: ChatId,
): string {
  const [first] = byLastUserMessage(
    chats.filter((chat) => chat.id !== except && !chat.archived),
  );
  return first === undefined ? CHATS_INDEX_HREF : chatHref(first.id);
}

/**
 * Where the place stands on arrival: the chat it showed last, while that
 * chat is still there, else the first chat in the inbox.
 */
export function placeArrivalHref(
  shown: string | undefined,
  chats: Parameters<typeof firstChatHref>[0],
): string {
  const chat = shown === undefined ? undefined : chatOfHref(shown);
  return shown !== undefined &&
    chat !== undefined &&
    chats.some((each) => each.id === chat)
    ? shown
    : firstChatHref(chats);
}

/**
 * Set around the place's chat and list: what the list and the chat's head
 * do differently there. `away` takes the place off a chat that is going
 * (archived, deleted), to the next one, since the place has no tab to close.
 */
export const ChatsPlaceContext = createContext<null | {
  away: (leaving?: ChatId) => void;
}>(null);

/** The place around this screen, or null outside it. */
export function useChatsPlaceAround() {
  return use(ChatsPlaceContext);
}

/**
 * The window's Chats place: whether it is up, and going there. Its one tab
 * is kept in the window's own file, at the chat last viewed there, and made
 * on the first visit.
 */
export function useChatsPlace() {
  const store = useStore();
  const queryClient = useQueryClient();
  const appTabs = useAppTabs();
  const windowTabs = useWindowTabs();
  const isUp = useRouterState({
    select: (state) => isChatsPlaceHref(state.location.href),
  });
  const chatsNow = () =>
    queryClient.getQueryData(chatListOptions().queryKey) ?? [];
  const placeTab = () =>
    selectedTabIn(store.get(windowTabsAtom), CHATS_PLACE_GROUP);

  /** The place's tab at an address, made when it has none. */
  const standAt = (href: string) => {
    const tab = placeTab();
    if (tab === undefined) {
      windowTabs.openIn(
        { group: CHATS_PLACE_GROUP, href, id: newScreenId(), kind: "screen" },
        { group: CHATS_PLACE_GROUP, select: true },
      );
    } else if (tab.kind !== "screen" || !sameHref(tab.href, href)) {
      windowTabs.visitHref(tab.id, href);
    }
  };

  /** The place up, at `chat` when one is named, else where it was left (`placeArrivalHref`). */
  const enter = (chat?: ChatId) => {
    const tab = placeTab();
    standAt(
      chat === undefined
        ? placeArrivalHref(
            tab?.kind === "screen" ? tab.href : undefined,
            chatsNow(),
          )
        : chatHref(chat),
    );
    const model = store.get(appTabsAtom);
    const up = model.tabs.find((each) => each.id === model.selectedId);
    if (up === undefined || !isChatsPlaceHref(up.pathname)) {
      appTabs.navigate(CHATS_PLACE_HREF);
    }
  };

  return {
    /** The place off a chat that is going, to the first other chat in the inbox. */
    away: (leaving?: ChatId) => {
      standAt(firstChatHref(chatsNow(), leaving));
    },
    enter,
    isUp,
  };
}
