import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import { rpcClient } from "@/client/rpc/client";
import { type QueryClient, queryOptions } from "@tanstack/react-query";

import { type ChatListState, takeChatListEvent } from "./chat-list-fold";
import { type Chat, railMarkOf } from "./chats";

/** What each window holds of the list, by the window's query client. */
const states = new WeakMap<QueryClient, ChatListState>();

function stateOf(client: QueryClient): ChatListState {
  let state = states.get(client);
  if (!state) {
    state = {};
    states.set(client, state);
  }
  return state;
}

const CHAT_LIST_KEY = ["chat-list"] as const;

/**
 * The window's live chat list, with what every reader of it shares: a chat
 * that did not change keeps its object across updates, dates and all, so the
 * rows memoized on it stay put when another chat moves. Every reader passes
 * the same options, since the one query holds one set.
 *
 * `chats.live.rows` sends every row and then only what changed, which is
 * folded into the rows held here; a change that does not go on from them
 * (the workspace started its list over, or one was missed) reads the list
 * again from the start, on the same query.
 */
export function chatListOptions() {
  return queryOptions({
    queryFn: async ({ client, signal }): Promise<Chat[]> => {
      const state = stateOf(client);
      let shown: Chat[] | undefined;
      let again = true;
      while (again) {
        again = false;
        const events = await rpcClient.workspace.chats.live.rows.call(
          undefined,
          { signal },
        );
        for await (const event of events) {
          if (signal.aborted) {
            throw signal.reason;
          }
          const next = takeChatListEvent(state, event);
          if (!next) {
            // Leaving the loop ends this subscription; the next one opens
            // with every row.
            again = true;
            break;
          }
          shown = next;
          client.setQueryData(CHAT_LIST_KEY, shown);
        }
      }
      if (!shown) {
        throw new Error("The chat list closed before it sent anything.");
      }
      return shown;
    },
    queryKey: CHAT_LIST_KEY,
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
