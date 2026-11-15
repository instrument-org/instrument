import { workingTabOf } from "@/shared/working-tab";
import { type ChatId } from "@instrument-org/workspace/client";

import { type Chat } from "./chats";
import { chatOfTab, groupLayoutOf, type WindowTabs } from "./tab-model";

/** Whether a chat wants a look: a reply not yet seen, or a question or card waiting on the person. */
function wantsLook(chat: Chat): boolean {
  return chat.status === "waiting" || chat.unread;
}

/** How many chats the list shows before the rest wait behind its More row. */
export const ACTIVE_CHATS_SHOWN = 3;

/**
 * The chats a sidebar row shows: the tab up on each side of each group the
 * window lists, the group up included. A chat behind another tab in its side
 * is not one of them.
 */
export function chatsInView(
  state: WindowTabs,
  listed: readonly string[],
): Set<ChatId> {
  return new Set(
    listed.flatMap((group) =>
      groupLayoutOf(state, group).sides.flatMap((side) => {
        const up = side.tabs.find((tab) => tab.id === side.up);
        const chat = up === undefined ? undefined : chatOfTab(up);
        return chat === undefined ? [] : [chat];
      }),
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
 * The sidebar's Chats list. A chat joins when it comes to want a look
 * (`wantsLook`: its reply lands unseen, or it asks) while no sidebar row
 * shows it (`inView`), and on the first look when it already wants one out
 * of view. It stays until it wants a look no longer: seen, with nothing
 * waiting. A chat that already wanted a look when it went out of view never
 * joins, so moving between tabs never changes the list.
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
  const wanted = before.wanting && new Set(before.wanting);
  const listed = new Set(before.list);
  const list = before.list.flatMap((id) => {
    const chat = wanting.get(id);
    return chat === undefined ? [] : [chat];
  });
  for (const chat of wanting.values()) {
    if (
      listed.has(chat.id) ||
      inView.has(chat.id) ||
      wanted?.has(chat.id) === true
    ) {
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

/**
 * The tab a chat clicked in the list comes up in, rather than a copy: of its
 * tabs in this window's groups, the one its agent works from
 * (`workingTabOf`), else the same of its tabs in another open window's
 * groups. None while no open group holds it, and the list opens it a tab of
 * its own.
 */
export function tabHoldingChat<
  T extends { group?: string; href?: string; promptedAt?: number },
>(
  tabs: readonly T[],
  chat: ChatId,
  {
    isHere,
    isOpen,
  }: {
    isHere: (group: string) => boolean;
    isOpen: (group: string) => boolean;
  },
): (T & { group: string }) | undefined {
  return workingTabOf(tabs, chat, isHere) ?? workingTabOf(tabs, chat, isOpen);
}
