import {
  type ChosenItem,
  type Draft,
  type DraftContextItem,
} from "@/shared/drafts";
import { type WindowTab } from "@/client/atoms/window";
import { instrumentLinkOf } from "@instrument-org/shared";
import { type ChatId } from "@instrument-org/workspace/client";

import { includedItemsOf, isIncludable } from "./draft-context";
import { isFreshTab, isHomeTab } from "./tab-model";
import { chatOfGroup, chatOfHref } from "./window-href";

/** How the key of a chip naming a file or folder by its path starts. */
const CHOSEN_KEY = "chosen:";

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
 * - `chat`: another chat a draft names in its `context`, by its id alone:
 *   what is in it is that chat's. Nothing on screen becomes one.
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
    tab.group === group
      ? undefined
      : (chatOfGroup(tab.group) ??
        (tab.kind === "screen" ? chatOfHref(tab.href) : undefined));
  if (otherChat !== undefined) {
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
 * What a draft carries, in the order its chips stand: what is on screen now
 * (the tab its own band has up, then what the window has in view), less
 * what the person dismissed, then what they chose, its `context`.
 *
 * The screen's chips are worked out on every read, so they follow the
 * screen while the person writes, and are never written to the draft's
 * file. The chat on screen is never one of them: a reply names its chat.
 */
export function draftContextItems({
  allTabs,
  bandUp,
  dismissed,
  draft,
  finderOf,
  group,
  inView,
}: {
  allTabs: WindowTab[];
  /** The tab the draft's own band has up, when the band shows one. */
  bandUp: undefined | WindowTab;
  /** The keys of the screen's chips the person dismissed in this draft. */
  dismissed: readonly string[];
  draft: Draft;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  group: string;
  /** What the window has in view now. */
  inView: undefined | WindowTab;
}): ContextItem[] {
  const chosen = dedupeChats(
    (draft.context ?? []).map((entry) => contextItemOf(entry, allTabs)),
  );
  // A file or folder the person took off stays off: the screen names it no
  // more than the draft does, so a Finder whose selection it was stands
  // for its folder again rather than for it.
  const takenOff = dismissed.flatMap((key) =>
    key.startsWith(CHOSEN_KEY)
      ? [{ kind: "file" as const, path: key.slice(CHOSEN_KEY.length) }]
      : [],
  );
  const screen: ContextItem[] = [];
  for (const tab of [bandUp, inView]) {
    const key = keyOfTab(tab);
    if (!tab || dismissed.includes(key)) {
      continue;
    }
    const item = itemOfTab(tab, {
      finderOf,
      group,
      held: [...heldPaths([...chosen, ...screen]), ...takenOff],
      key,
    });
    if (
      item &&
      ![...chosen, ...screen].some((entry) => entry.key === item.key)
    ) {
      screen.push(item);
    }
  }
  return [...screen, ...chosen];
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
      return `${CHOSEN_KEY}${entry.path}`;
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
 * it is open, and otherwise what the window has in view behind a popped-out
 * chat, unless left out. Another chat is never one of them.
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
  /** What the window has in view behind the chat, while it is popped out with its own view closed. */
  inView: undefined | WindowTab;
  leftOut: readonly string[];
  /** The chat's tab up, while the chat's view of it is open. */
  up: undefined | WindowTab;
}): ContextItem[] {
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
