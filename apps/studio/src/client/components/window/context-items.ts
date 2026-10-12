import {
  type ChosenItem,
  type Draft,
  type WindowTab,
} from "@/client/atoms/window";
import { type TabId } from "@/shared/tabs";
import { type ChatId } from "@instrument-org/workspace/client";

import {
  behindTabOf,
  includedItemsOf,
  includedTabOf,
  isIncludable,
} from "./draft-context";
import { isFreshTab, isHomeTab } from "./tab-model";
import { chatOfGroup, chatOfHref } from "./window-href";

/**
 * One thing a message carries about what the user was looking at, which the
 * composer shows as a chip with an x. A message carries these and nothing
 * else, so what the chips say is everything the conversation is told.
 *
 * - `chosen`: a file or folder picked to go by name.
 * - `tab`: a tab whose own group is sending (the chat's, or the draft's that
 *   becomes the chat's) or one of the window's own, carried by what it shows;
 *   `items` is what it points at on this computer, when that is something.
 * - `chat`: another chat, by its id alone: what is in it is that chat's.
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

/** Where a tab stands for a composer of `group`: the chat it is in, when that is another chat, or the tab itself. */
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
    tab.group === group
      ? undefined
      : (chatOfGroup(tab.group) ??
        (tab.kind === "screen" ? chatOfHref(tab.href) : undefined));
  if (otherChat !== undefined) {
    return otherChat === chatOfGroup(group)
      ? undefined
      : { chat: otherChat, key, kind: "chat" };
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

/** The chosen, tab and chat items' paths, so a later item does not say again what an earlier one holds. */
function heldPaths(items: ContextItem[]): ChosenItem[] {
  return items.flatMap((entry) =>
    entry.kind === "chosen"
      ? [entry.item]
      : entry.kind === "tab"
        ? (entry.items ?? [])
        : [],
  );
}

/**
 * What a draft carries, in the order its chips stand: what it was opened on
 * by name, the tab its band has up, the thing it was opened over, and what
 * the window has in view behind it now, each until it is left out.
 */
export function draftContextItems({
  allTabs,
  bandUp,
  draft,
  finderOf,
  group,
  hrefOfAppTab,
  inView,
}: {
  allTabs: WindowTab[];
  /** The tab the draft's own band has up, when the band shows one. */
  bandUp: undefined | WindowTab;
  draft: Draft;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  group: string;
  hrefOfAppTab: (id: TabId) => string | undefined;
  inView: undefined | WindowTab;
}): ContextItem[] {
  const items: ContextItem[] = (draft.chosen ?? []).map((item) => ({
    item,
    key: `chosen:${item.path}`,
    kind: "chosen" as const,
  }));
  const add = (tab: undefined | WindowTab, key: string) => {
    if (!tab || draft.leftOut?.includes(key)) {
      return;
    }
    const item = itemOfTab(tab, {
      finderOf,
      group,
      held: heldPaths(items),
      key,
    });
    if (item && !items.some((entry) => entry.key === item.key)) {
      items.push(item);
    }
  };
  add(bandUp, keyOfTab(bandUp));
  const included = includedTabOf(draft, allTabs, hrefOfAppTab);
  add(included, keyOfTab(included));
  const behind = behindTabOf(draft, inView);
  add(behind, keyOfTab(behind));
  return dedupeChats(items);
}

/**
 * What a chat's composer carries: the chat's own tab up while its view of
 * it is open, and otherwise what the window has in view behind the chat,
 * unless left out.
 */
export function chatContextItems({
  chatId,
  finderOf,
  inView,
  leftOut,
  up,
}: {
  chatId: ChatId;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  /** What the window has in view, as the chat's own view of its tab is closed. */
  inView: undefined | WindowTab;
  leftOut: readonly string[];
  /** The chat's tab up, while the chat's view of it is open. */
  up: undefined | WindowTab;
}): ContextItem[] {
  // The chat's own tab in view while its view of it is put away is the
  // chat's screen itself, which says nothing more than its tabs do.
  const tab = up ?? (inView?.group === chatId ? undefined : inView);
  const key = keyOfTab(tab);
  if (!tab || leftOut.includes(key)) {
    return [];
  }
  const item = itemOfTab(tab, { finderOf, group: chatId, held: [], key });
  return item ? [item] : [];
}

/**
 * The key a tab's chip is left out by. A screen of the window's own keeps
 * its tab's id wherever it walks, so it is keyed by where it stands too, and
 * a chip left out comes back once that screen is somewhere else.
 */
export function keyOfTab(tab: undefined | WindowTab): string {
  if (!tab) {
    return "";
  }
  return tab.kind === "screen" ? `tab:${tab.id} ${tab.href}` : `tab:${tab.id}`;
}

/** One chip per other chat, however many of its tabs stand behind a draft. */
function dedupeChats(items: ContextItem[]): ContextItem[] {
  const seen = new Set<ChatId>();
  return items.filter((entry) => {
    if (entry.kind !== "chat") {
      return true;
    }
    if (seen.has(entry.chat)) {
      return false;
    }
    seen.add(entry.chat);
    return true;
  });
}
