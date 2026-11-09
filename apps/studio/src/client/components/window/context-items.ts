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
 * The lines of `context` a tab of a draft's band stands for, as the draft's
 * file keeps them: the files or folders it points at on this computer, else
 * a page's address or an app's front by its own address. None for a tab
 * that shows something attached to the draft (`held`), or that names
 * nothing a line can (a new tab, the list of apps).
 */
export function bandTabLines(
  tab: WindowTab,
  {
    finderOf,
    held,
  }: {
    finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
    held: ChosenItem[];
  },
): DraftContextItem[] {
  const item = itemOfTab(tab, {
    finderOf,
    group: tab.group ?? "",
    held,
    key: keyOfTab(tab),
  });
  if (item?.kind !== "tab") {
    return [];
  }
  if (item.items !== undefined) {
    return item.items.map((entry) => ({ kind: entry.kind, path: entry.path }));
  }
  const url = tab.kind === "page" ? tab.url : instrumentUrlOf(tab.href);
  return url === undefined ? [] : [{ kind: "link", url }];
}

/** Which thing a line of `context` names, the same however a folder's path ends: what a band tab and a line are matched by. */
export function lineKeyOf(entry: DraftContextItem): string {
  return entry.kind === "file" || entry.kind === "folder"
    ? `${CHOSEN_KEY}${withoutSlash(entry.path)}`
    : contextKeyOf(entry);
}

/**
 * What a draft carries, in the order its chips stand: every tab of the
 * draft's own band, in the band's order, then each line of its `context` no
 * tab of the band stands for (another chat, and a line this window has yet
 * to open as a tab, see `useBandContext`). The file's lines are the record
 * and the band is how this window shows them, so a thing is one chip however
 * both name it. Each of the band's tabs is a chip: picking one shows it, and
 * taking one off closes it. A tab showing something attached to the draft is
 * no chip of its own: the attachment's chip is it. Two tabs showing the same
 * thing are one chip, the first in the band's order.
 *
 * What the window has in view behind the draft is never one of them: it is
 * offered beside the chips (`draftSuggestionOf`), and goes only once the
 * person takes it, which opens it in the band.
 */
export function draftContextItems({
  allTabs,
  band,
  draft,
  finderOf,
  group,
}: {
  allTabs: WindowTab[];
  /** The tabs of the draft's own band, in its order. */
  band: readonly WindowTab[];
  draft: Draft;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  group: string;
}): ContextItem[] {
  const attached = attachedPaths(draft);
  const shown = new Set(
    band.flatMap((tab) =>
      bandTabLines(tab, { finderOf, held: attached }).map(lineKeyOf),
    ),
  );
  const chosen = dedupeChats(
    (draft.context ?? [])
      .filter((entry) => !shown.has(lineKeyOf(entry)))
      .map((entry) => contextItemOf(entry, allTabs)),
  );
  const own: ContextItem[] = [];
  const lined = new Set<string>();
  for (const tab of band) {
    const lines = bandTabLines(tab, { finderOf, held: attached }).map(
      lineKeyOf,
    );
    if (lines.length > 0 && lines.every((line) => lined.has(line))) {
      continue;
    }
    for (const line of lines) {
      lined.add(line);
    }
    const key = keyOfTab(tab);
    const item = itemOfTab(tab, {
      finderOf,
      group,
      held: [...attached, ...heldPaths([...chosen, ...own])],
      key,
    });
    if (item && ![...chosen, ...own].some((entry) => entry.key === item.key)) {
      own.push(item);
    }
  }
  return [...own, ...chosen];
}

/**
 * What the window has in view behind a draft, offered to it as the chip it
 * would be: what is selected in a folder, else the folder, a file, a page or
 * an app's front. Taking it opens it in the draft's band (`openInBand`).
 * Nothing where the screen names nothing, where it is another chat's, or
 * where the draft already has it: a selection the draft has is not offered
 * again as the folder around it.
 */
export function draftSuggestionOf({
  allTabs,
  band,
  draft,
  finderOf,
  group,
  inView,
}: {
  allTabs: WindowTab[];
  band: readonly WindowTab[];
  draft: Draft;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  group: string;
  inView: undefined | WindowTab;
}): ContextItem | undefined {
  if (!inView || band.some((tab) => sameTarget(tab, inView))) {
    return undefined;
  }
  const item = itemOfTab(inView, {
    finderOf,
    group,
    held: [],
    key: keyOfTab(inView),
  });
  if (item?.kind !== "tab") {
    return undefined;
  }
  if (item.items !== undefined) {
    const carried = draftContextItems({
      allTabs,
      band,
      draft,
      finderOf,
      group,
    });
    const held = new Set(
      [...attachedPaths(draft), ...heldPaths(carried)].map((entry) =>
        withoutSlash(entry.path),
      ),
    );
    if (item.items.every((entry) => held.has(withoutSlash(entry.path)))) {
      return undefined;
    }
  }
  return item;
}

/** What is attached to a draft by its path, which a tab of its band showing the same thing does not say again. */
export function attachedPaths(draft: Draft): ChosenItem[] {
  return [...(draft.attached ?? []), ...(draft.inFolder ?? [])].map(
    (entry) => ({ kind: entry.kind, path: entry.path }),
  );
}

function withoutSlash(path: string) {
  return path.length > 1 ? path.replace(/[/\\]+$/, "") : path;
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
 * What a chat's next message carries: the chat's own tab up while its view
 * of it is open, then what the person took for this message from what was
 * offered (`chatSuggestionOf`), as it was when taken. Another chat is never
 * one of them.
 */
export function chatContextItems({
  chatId,
  finderOf,
  taken,
  up,
}: {
  chatId: ChatId;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  /** What the person took for the next message. */
  taken: readonly ContextItem[];
  /** The chat's tab up, while the chat's view of it is open. */
  up: undefined | WindowTab;
}): ContextItem[] {
  const own = up
    ? itemOfTab(up, { finderOf, group: chatId, held: [], key: keyOfTab(up) })
    : undefined;
  return own
    ? [own, ...taken.filter((item) => item.key !== own.key)]
    : [...taken];
}

/**
 * What the window has in view behind a popped-out chat, offered to its next
 * message as the chip it would be: what is selected in a folder, else the
 * folder, a file, a page or an app's front. Nothing where the screen names
 * nothing, where it is the chat itself or another chat, or where the message
 * already carries it.
 */
export function chatSuggestionOf({
  chatId,
  finderOf,
  inView,
  taken,
}: {
  chatId: ChatId;
  finderOf: (id: string) => null | { folder: string; selected: ChosenItem[] };
  inView: undefined | WindowTab;
  taken: readonly ContextItem[];
}): ContextItem | undefined {
  if (!inView || inView.group === chatId) {
    return undefined;
  }
  const item = itemOfTab(inView, {
    finderOf,
    group: chatId,
    held: [],
    key: keyOfTab(inView),
  });
  if (item?.kind !== "tab") {
    return undefined;
  }
  if (item.items === undefined) {
    return taken.some(
      (entry) => entry.kind === "tab" && sameTarget(entry.tab, item.tab),
    )
      ? undefined
      : item;
  }
  const held = new Set(
    heldPaths([...taken]).map((entry) => withoutSlash(entry.path)),
  );
  return item.items.every((entry) => held.has(withoutSlash(entry.path)))
    ? undefined
    : item;
}

/**
 * The key a tab's chip is left out by. A screen of the window's own keeps
 * its tab's id wherever it walks, so it is keyed by where it stands too, and
 * a chip left out comes back once that screen is somewhere else.
 */
/** Whether two tabs show the same thing: the same page, or the same screen. */
function sameTarget(one: WindowTab, other: WindowTab): boolean {
  if (one.kind === "page" && other.kind === "page") {
    return one.url !== undefined && one.url === other.url;
  }
  return (
    one.kind === "screen" && other.kind === "screen" && one.href === other.href
  );
}

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
