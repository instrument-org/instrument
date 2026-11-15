import { type ChatId } from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import { chatsWithNoTab } from "./tab-groups";
import { type WindowTabs } from "./tab-model";

/** Whether a chat wants a look: a question or card waits on the person, a reply is unseen, or it is still working. */
function wantsLook(chat: Chat): boolean {
  return chat.status === "waiting" || chat.unread || chat.working;
}

/**
 * The chats the sidebar's Chats list shows: each that wants a look
 * (`wantsLook`) and that no tab in this window holds, in any group, up or
 * not. `before` is the list as it last stood: those still in it keep their
 * places, and newcomers join at its end in the order `chats` has them, so
 * nothing moves under the pointer but a row that leaves.
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
  return [...kept, ...[...shown.values()].filter((c) => !stayed.has(c.id))];
}
