import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import { rpcClient } from "@/client/rpc/client";

import { type Chat, railMarkOf } from "./chats";

/**
 * The window's live chat list, with what every reader of it shares:
 * a chat that did not change keeps its object across updates, dates and
 * all, so the rows memoized on it stay put when another chat moves. Every
 * reader passes the same options, since the one query holds one set.
 */
export function chatListOptions() {
  return rpcClient.workspace.chats.live.list.experimental_liveOptions({
    structuralSharing: shareEqualDeep,
  });
}

/**
 * What the window's own chrome draws from the chat list, in the list's
 * order: each chat's title, and the mark it wears where it wears one. Pairs
 * of plain values, so an answer that moves neither keeps both as they were
 * and the window is not drawn again for it.
 */
export function chromeOfChats(chats: Chat[]) {
  return {
    marks: chats.flatMap((chat) => {
      const mark = railMarkOf([chat]);
      return mark ? [[chat.id, mark] as const] : [];
    }),
    titles: chats.map((chat) => [chat.id, chat.title] as const),
  };
}
