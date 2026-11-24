import {
  browserTargetOf,
  type BrowserTargetId,
  type ChatId,
} from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import { type WindowTab } from "@/client/atoms/window";
import { chatOfTab } from "./tab-model";

/**
 * Whether closing a chat's tab stops it: an agent of its at work, or a
 * question or card waiting on the person. A chat that is only unread has
 * nothing to stop.
 */
function isStoppedByClose(chat: Pick<Chat, "status" | "working">): boolean {
  return chat.working || chat.status === "working" || chat.status === "waiting";
}

/**
 * The chats a close of these tabs stops, each once, in tab order: every chat
 * one of them shows that is at work or waiting, whether or not another tab
 * shows it too. None while the list has not been read.
 */
export function chatsStoppedByClose(
  tabs: readonly WindowTab[],
  chats: readonly Chat[] | undefined,
): Chat[] {
  if (chats === undefined) {
    return [];
  }
  const byId = new Map(chats.map((chat) => [chat.id, chat]));
  const seen = new Set<ChatId>();
  return tabs.flatMap((tab) => {
    const id = chatOfTab(tab);
    const chat = id === undefined ? undefined : byId.get(id);
    if (chat === undefined || seen.has(chat.id) || !isStoppedByClose(chat)) {
      return [];
    }
    seen.add(chat.id);
    return [chat];
  });
}

/** A chat a close stops since the page its agent is on closes, and that page. */
export interface StoppedByPage {
  chat: Chat;
  page: { title: string; url: string };
  tab: string;
}

/**
 * The chats a close of these tabs stops since an agent of theirs is on a page
 * among them (`inUse`), each once with the first such page in tab order. A
 * chat the list does not have has nobody to ask about.
 */
export function chatsStoppedByPages(
  tabs: readonly WindowTab[],
  chats: readonly Chat[] | undefined,
  inUse: readonly { chatId: ChatId; targetId: BrowserTargetId }[] | undefined,
): StoppedByPage[] {
  const seen = new Set<ChatId>();
  return tabs.flatMap((tab) => {
    if (tab.kind !== "page") {
      return [];
    }
    const target = browserTargetOf(tab.id);
    return (inUse ?? []).flatMap(({ chatId, targetId }) => {
      const chat = chats?.find((each) => each.id === chatId);
      if (targetId !== target || chat === undefined || seen.has(chatId)) {
        return [];
      }
      seen.add(chatId);
      return [
        {
          chat,
          page: {
            title: tab.title ?? "",
            url: tab.url ?? tab.openedUrl ?? "",
          },
          tab: tab.id,
        },
      ];
    });
  });
}

/** What a close takes away, which the question names. */
export type ClosingWhat = "group" | "split" | "tab" | "window";

/**
 * The question's words: its title, and the line under it naming the chat,
 * or counting the chats when there are several.
 */
export function stopQuestionCopy({
  chats,
  closes,
  isUsingPage = false,
  what,
}: {
  chats: readonly Pick<Chat, "title">[];
  /** How many tabs or groups the close takes away. */
  closes: number;
  /** The one chat is stopped by the close of the page its agent is on. */
  isUsingPage?: boolean;
  what: ClosingWhat;
}): { description: string; title: string } {
  const closing =
    what === "window"
      ? "this window"
      : what === "split"
        ? "this split"
        : what === "group"
          ? closes > 1
            ? "these tab groups"
            : "this tab group"
          : closes > 1
            ? "these tabs"
            : "this tab";
  const [only] = chats;
  if (chats.length === 1 && only) {
    const named = only.title.trim() === "" ? "this chat" : `“${only.title}”`;
    const using = named === "this chat" ? "This chat" : named;
    return {
      description: isUsingPage
        ? what === "tab" && closes === 1
          ? `${using} is using this page. Closing this tab stops what it's working on.`
          : `${using} is using a page in ${closing}. Closing it stops the chat's work.`
        : `Closing ${closing} stops what ${named} is working on.`,
      title: "Stop this chat?",
    };
  }
  return {
    description: `Closing ${closing} stops what these chats are working on.`,
    title: `Stop ${chats.length.toString()} chats?`,
  };
}
