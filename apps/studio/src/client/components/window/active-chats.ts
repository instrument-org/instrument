import { type ChatId } from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import { chatsWithNoTab } from "./tab-groups";
import { type WindowTabs } from "./tab-model";

/** Whether a chat wants a look: a question or card waits on the person, a reply is unseen, or it is still working. */
function wantsLook(chat: Chat): boolean {
  return chat.status === "waiting" || chat.unread || chat.working;
}

/** How many chats the list shows before the rest wait behind its More row. */
export const ACTIVE_CHATS_SHOWN = 3;

/**
 * The chats the sidebar's Chats list shows: each that wants a look
 * (`wantsLook`) and that no tab in this window holds, in any group, up or
 * not. `before` is the list as it last stood, and those still in it keep
 * their places. The list grows upward from the sidebar's foot, so a newcomer
 * joins at its top while fewer than `ACTIVE_CHATS_SHOWN` show, leaving the
 * rows under it where they were, and at its end, behind the More row, once
 * that many do. Newcomers join in the order `chats` has them. Nothing moves
 * under the pointer but a row that leaves.
 */
export function activeChats(
  chats: readonly Chat[],
  state: WindowTabs,
  before: readonly ChatId[],
): Chat[] {
  const shown = new Map(
    chatsWithNoTab(chats, state)
      .filter((chat) => wantsLook(chat))
      .map((chat) => [chat.id, chat]),
  );
  const kept = before.flatMap((id) => {
    const chat = shown.get(id);
    return chat === undefined ? [] : [chat];
  });
  const stayed = new Set(before);
  const list = [...kept];
  for (const chat of shown.values()) {
    if (stayed.has(chat.id)) {
      continue;
    }
    if (list.length < ACTIVE_CHATS_SHOWN) {
      list.unshift(chat);
    } else {
      list.push(chat);
    }
  }
  return list;
}
