import { rpcClient } from "@/client/rpc/client";
import { type ChatId, type ListedAt } from "@instrument-org/workspace/client";
import { type QueryClient, queryOptions } from "@tanstack/react-query";

import {
  addPaint,
  type ChatListState,
  type ChatRowChange,
  dropPaint,
  emptyChatListState,
  landPaint,
  shareChatList,
  shownChats,
  takeChatListEvent,
} from "./chat-list-fold";
import { type Chat, railMarkOf } from "./chats";

/** What each window holds of the list, by the window's query client. */
const states = new WeakMap<QueryClient, ChatListState>();

function stateOf(client: QueryClient): ChatListState {
  let state = states.get(client);
  if (!state) {
    state = emptyChatListState();
    states.set(client, state);
  }
  return state;
}

const CHAT_LIST_KEY = ["chat-list"] as const;

/** Callers waiting on the held list to reach a revision, by the window's query client. */
const waiters = new WeakMap<QueryClient, Set<() => boolean>>();

/** How long `chatListed` waits before giving up on the list. */
const LISTED_WAIT_MS = 2000;

/** Whether the held list has taken in what `at` names, or was read again since. */
function hasReached(state: ChatListState, at: ListedAt) {
  const { held } = state;
  return held !== undefined && (held.epoch !== at.epoch || held.rev >= at.rev);
}

/** Puts what the window shows of the list into its query, once it holds a list. */
function show(client: QueryClient, state: ChatListState) {
  const shown = shownChats(state);
  if (shown) {
    client.setQueryData(CHAT_LIST_KEY, shown);
  }
  for (const settled of waiters.get(client) ?? []) {
    settled();
  }
  return shown;
}

/**
 * Resolves once the list this window holds has taken in what a request
 * answered with (`at`), so a reader of the list finds the row the request
 * made; at once when there is no list to wait for, and after a short wait
 * at most, so a list that stopped never holds up what waits on it.
 */
export function chatListed(client: QueryClient, at: ListedAt | null) {
  const state = stateOf(client);
  if (!at || hasReached(state, at)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const set = waiters.get(client) ?? new Set();
    waiters.set(client, set);
    const settle = () => {
      clearTimeout(timer);
      set.delete(settled);
      resolve();
      return true;
    };
    const settled = () => hasReached(state, at) && settle();
    const timer = setTimeout(settle, LISTED_WAIT_MS);
    set.add(settled);
  });
}

/**
 * The window's live chat list, with what every reader of it shares: a chat
 * that did not change keeps its object across updates, dates and all, so the
 * rows memoized on it stay put when another chat moves. Every reader passes
 * the same options, since the one query holds one set.
 *
 * `chats.live.rows` sends every row and then only what changed, which is
 * folded into the rows held here; a change that does not go on from them
 * (the workspace started its list over, or one was missed) reads the list
 * again from the start, on the same query. What the query holds is those
 * rows with the window's paints over them (`paintChatRow`), so every reader
 * sees a click at once and no answer from before the request takes it back.
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
          if (!takeChatListEvent(state, event)) {
            // Leaving the loop ends this subscription; the next one opens
            // with every row.
            again = true;
            break;
          }
          shown = show(client, state);
        }
      }
      if (!shown) {
        throw new Error("The chat list closed before it sent anything.");
      }
      return shown;
    },
    queryKey: CHAT_LIST_KEY,
    structuralSharing: shareChatList,
  });
}

/**
 * Paints a change onto a chat's row in this window from the click rather
 * than from the round trip: every reader of the list sees the row move, or
 * its mark change, the moment it is asked for. `landed` takes the request's
 * answer, and the paint goes once the list the window holds is at the
 * revision it names, so an answer the list sent from before the request
 * never takes it back; `failed` takes it back at once.
 */
export function paintChatRow(
  client: QueryClient,
  id: ChatId,
  change: ChatRowChange,
) {
  const state = stateOf(client);
  const paint = addPaint(state, id, change);
  show(client, state);
  return {
    failed: () => {
      dropPaint(state, paint);
      show(client, state);
    },
    landed: (at: ListedAt | null) => {
      landPaint(state, paint, at);
      show(client, state);
    },
  };
}

export type ChatRowPainting = ReturnType<typeof paintChatRow>;

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
