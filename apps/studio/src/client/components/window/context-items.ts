import { type ChosenItem } from "@/shared/drafts";
import { type WindowTab } from "@/client/atoms/window";
import { type ChatId } from "@instrument-org/workspace/client";

import { includedItemsOf, isIncludable } from "./draft-context";
import { chatOfTab, isFreshTab, isHomeTab, isNewChatTab } from "./tab-model";
import { chatOfHref } from "./window-href";

/**
 * One thing a message carries about what the user was looking at, which the
 * composer shows as a chip with an x. A message carries these and nothing
 * else, so what the chips say is everything the conversation is told.
 *
 * - `chosen`: a file or folder picked to go by name.
 * - `tab`: a tab whose own group is sending (the chat's, or the draft's that
 *   becomes the chat's) or one of the window's own, carried by what it shows;
 *   `items` is what it points at on this computer, when that is something.
 *   A page or an app a draft names by its address is a tab too: the
 *   window's own showing it, or one standing for it.
 * - `chat`: another chat, by its id alone: what is in it is that chat's. A
 *   draft names one in its `context`; a chat's tab in the sending group is
 *   never one.
 */
export type ContextItem =
  | { item: ChosenItem; key: string; kind: "chosen" }
  | { chat: ChatId; key: string; kind: "chat" }
  | {
      items: ChosenItem[] | undefined;
      key: string;
      kind: "tab";
      /** Whether the tab is the sending group's, so the conversation may name it by its id. */
      owned: boolean;
      tab: WindowTab;
    };

/** The item a tab is for a composer of `group`: nothing when it belongs to another chat, which is that chat's. */
function itemOfTab(
  tab: WindowTab,
  {
    finderOf,
    group,
    held,
    key,
  }: {
    finderOf: (id: string) => null | {
      folder: string;
      selected: ChosenItem[];
    };
    group: string;
    held: ChosenItem[];
    key: string;
  },
): ContextItem | undefined {
  const otherChat =
    tab.group === group || tab.kind !== "screen"
      ? undefined
      : chatOfHref(tab.href);
  if (otherChat !== undefined) {
    return;
  }
  // A chat or a new chat in the sender's group is a conversation of its
  // own, never something a message carries.
  if (
    tab.group === group &&
    (chatOfTab(tab) !== undefined || isNewChatTab(tab))
  ) {
    return;
  }
  // The sending group's own screens (a chat's tasks, say) say what they
  // show; anyone else's go only as a page, a file or folder, or an app.
  const owned = tab.group === group;
  if (
    isFreshTab(tab) ||
    (tab.kind === "screen" && isHomeTab(tab)) ||
    (!owned && !isIncludable(tab))
  ) {
    return;
  }
  const items = includedItemsOf(tab, finderOf(tab.id), held);
  if (items !== undefined && items.length === 0) {
    return;
  }
  return { items, key, kind: "tab", owned, tab };
}

/**
 * What a message from a tab carries, a chat's or a new chat's: the tab up
 * beside the sending one. Another chat is never one of them.
 */
export function chatContextItems({
  finderOf,
  group,
  up,
}: {
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  /** The group the sending tab is in, whose tabs are its own. */
  group: string;
  /** The tab up beside the sending one, which goes with the message. */
  up: undefined | WindowTab;
}): ContextItem[] {
  const own = up
    ? itemOfTab(up, { finderOf, group, held: [], key: keyOfTab(up) })
    : undefined;
  return own ? [own] : [];
}

function keyOfTab(tab: undefined | WindowTab): string {
  if (!tab) {
    return "";
  }
  return tab.kind === "screen" ? `tab:${tab.id} ${tab.href}` : `tab:${tab.id}`;
}
