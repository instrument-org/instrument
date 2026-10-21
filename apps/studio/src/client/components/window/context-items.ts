import {
  type ChosenItem,
  type Draft,
  type DraftContextItem,
} from "@/shared/drafts";
import { type WindowTab } from "@/client/atoms/window";
import { instrumentLinkOf, instrumentUrlOf } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/client";

import { includedItemsOf, isIncludable } from "./draft-context";
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
 *   A page or an app a draft names by its address is a tab too: the
 *   window's own showing it, or one standing for it.
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
 * What a draft carries, in the order its chips stand: its `context`, then
 * the tab its own band has up unless that chip was taken off.
 */
export function draftContextItems({
  allTabs,
  bandUp,
  draft,
  finderOf,
  group,
}: {
  allTabs: WindowTab[];
  /** The tab the draft's own band has up, when the band shows one. */
  bandUp: undefined | WindowTab;
  draft: Draft;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  group: string;
}): ContextItem[] {
  const items = (draft.context ?? []).map((entry) =>
    contextItemOf(entry, allTabs),
  );
  const key = keyOfTab(bandUp);
  if (bandUp && !draft.leftOut?.includes(key)) {
    const item = itemOfTab(bandUp, {
      finderOf,
      group,
      held: heldPaths(items),
      key,
    });
    if (item && !items.some((entry) => entry.key === item.key)) {
      items.push(item);
    }
  }
  return dedupeChats(items);
}

/**
 * What a draft made now carries about the tab it is made over: what the tab
 * points at on this computer (see `includedItemsOf`), less what `chosen`
 * already names, or else the page or the app's front by its address.
 */
export function contextOfTab(
  tab: WindowTab,
  finder: null | { folder: string; selected: ChosenItem[] },
  chosen: ChosenItem[],
): DraftContextItem[] {
  const items = includedItemsOf(tab, finder, chosen);
  if (items !== undefined) {
    return items;
  }
  const url = tab.kind === "page" ? tab.url : instrumentUrlOf(tab.href);
  return url ? [{ kind: "link", url }] : [];
}

/** The key a draft's chip for one of its `context` items is known by, and taken off by. */
export function contextKeyOf(entry: DraftContextItem): string {
  switch (entry.kind) {
    case "chat": {
      return `chat:${entry.chat}`;
    }
    case "link": {
      return `link:${entry.url}`;
    }
    case "file":
    case "folder": {
      return `chosen:${entry.path}`;
    }
  }
}

/**
 * The chip one of a draft's `context` items is. A page is the window's own
 * tab at that address while there is one, so its words go with the message;
 * otherwise it, like an app's front, is a tab standing for the address.
 */
function contextItemOf(
  entry: DraftContextItem,
  allTabs: WindowTab[],
): ContextItem {
  const key = contextKeyOf(entry);
  switch (entry.kind) {
    case "chat": {
      return { chat: entry.chat, key, kind: "chat" };
    }
    case "link": {
      const href = instrumentLinkOf(entry.url)?.href;
      const tab: WindowTab =
        href === undefined
          ? (allTabs.find(
              (open) => open.kind === "page" && open.url === entry.url,
            ) ?? {
              id: key,
              kind: "page",
              openedAt: 0,
              title: entry.url,
              url: entry.url,
            })
          : { href, id: key, kind: "screen" };
      return { items: undefined, key, kind: "tab", owned: false, tab };
    }
    case "file":
    case "folder": {
      return { item: entry, key, kind: "chosen" };
    }
  }
}

/**
 * What a chat's composer carries: the chat's own tab up while its view of
 * it is open, and otherwise what the window has in view behind the chat,
 * unless left out.
 */
export function chatContextItems({
  chatId,
  chatOnScreen,
  finderOf,
  inView,
  leftOut,
  up,
}: {
  chatId: ChatId;
  /** The chat the window has on screen, its pane open or not. */
  chatOnScreen: ChatId | undefined;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  /** What the window has in view, as the chat's own view of its tab is closed. */
  inView: undefined | WindowTab;
  leftOut: readonly string[];
  /** The chat's tab up, while the chat's view of it is open. */
  up: undefined | WindowTab;
}): ContextItem[] {
  // Another chat on screen behind this one is that chat, its pane open or
  // not; this chat's own screen says nothing more than its tabs do.
  if (up === undefined && chatOnScreen !== undefined) {
    const key = `chat:${chatOnScreen}`;
    return chatOnScreen === chatId || leftOut.includes(key)
      ? []
      : [{ chat: chatOnScreen, key, kind: "chat" }];
  }
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
function keyOfTab(tab: undefined | WindowTab): string {
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
