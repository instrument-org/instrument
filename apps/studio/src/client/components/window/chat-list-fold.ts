import { shareEqualDeep } from "@/client/lib/share-equal-deep";
import {
  type ChatListEvent,
  foldChatList,
  type HeldChatList,
} from "@instrument-org/workspace/client";

import { type Chat } from "./chats";

/** What a window holds of the chat list: the rows as the workspace last sent them. */
export interface ChatListState {
  held?: HeldChatList<Chat>;
}

/**
 * Takes in what the list sent, and answers with the rows to show, or none
 * when it does not go on from what the window holds, which means reading the
 * list again from the start. A row that did not change keeps its object, a
 * row sent again unchanged included, so what is drawn from it is not drawn
 * again.
 */
export function takeChatListEvent(
  state: ChatListState,
  event: ChatListEvent<Chat>,
): Chat[] | undefined {
  const held = foldChatList(state.held, event, shareEqualDeep);
  if (!held) {
    return undefined;
  }
  state.held = held;
  return held.rows;
}
