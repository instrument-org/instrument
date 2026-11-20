import { type ChatId } from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import { chatOfTab, groupLayoutOf, type WindowTabs } from "./tab-model";

/** Whether a chat wants a look: at work, a reply not yet seen, or a question or card waiting on the person. */
function wantsLook(chat: Chat): boolean {
  return (
    chat.status === "working" || chat.status === "waiting" || chat.unread
  );
}

/** How many chats the list shows before the rest wait behind its More row. */
export const ACTIVE_CHATS_SHOWN = 3;

/**
 * The chats a sidebar row shows: every tab of each group the window lists,
 * the group up included, since a row marks each of its tabs.
 */
export function chatsInView(
  state: WindowTabs,
  listed: readonly string[],
): Set<ChatId> {
  return new Set(
    listed.flatMap((group) =>
      groupLayoutOf(state, group).sides.flatMap((side) =>
        side.tabs.flatMap((tab) => {
          const chat = chatOfTab(tab);
          return chat === undefined ? [] : [chat];
        }),
      ),
    ),
  );
}

/**
 * What the list keeps from one look to the next: its chats in their order,
 * and the chats that wanted a look then, which tells a chat that has just
 * come to want one from a chat that already did. No `wanting` is the first
 * look, when every chat that wants a look is new.
 */
export interface ActiveChatsKept {
  list: readonly ChatId[];
  wanting?: readonly ChatId[];
}

/**
 * The sidebar's Chats list: every chat no sidebar row shows (`inView`) that
 * wants a look (`wantsLook`: at work, its reply unseen, or it asks), so a
 * chat whose group was closed while it worked stays in sight. It leaves
 * once it wants a look no longer, or a row shows it again.
 *
 * Those that stay keep their places. The list grows upward from the
 * sidebar's foot, so a newcomer joins at its top while fewer than
 * `ACTIVE_CHATS_SHOWN` show, leaving the rows under it where they were, and
 * at its end, behind the More row, once that many do, in the order `chats`
 * has them. Nothing moves under the pointer but a row that leaves.
 */
export function activeChats(
  chats: readonly Chat[],
  inView: ReadonlySet<ChatId>,
  before: ActiveChatsKept,
): { chats: Chat[]; kept: ActiveChatsKept } {
  const wanting = new Map(
    chats.filter((chat) => wantsLook(chat)).map((chat) => [chat.id, chat]),
  );
  const listed = new Set(before.list);
  const list = before.list.flatMap((id) => {
    const chat = wanting.get(id);
    return chat === undefined || inView.has(id) ? [] : [chat];
  });
  for (const chat of wanting.values()) {
    if (listed.has(chat.id) || inView.has(chat.id)) {
      continue;
    }
    if (list.length < ACTIVE_CHATS_SHOWN) {
      list.unshift(chat);
    } else {
      list.push(chat);
    }
  }
  return {
    chats: list,
    kept: {
      list: list.map((chat) => chat.id),
      wanting: [...wanting.keys()],
    },
  };
}
