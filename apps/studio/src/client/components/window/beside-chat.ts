import { type WindowTab } from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";

import { computerTabOf } from "./file-tabs";
import {
  chatOfTab,
  type GroupLayout,
  groupLayoutOf,
  isHomeTab,
  openInGroup,
  raiseTab,
  replaceTab,
  selectTab,
  sideIndexOf,
  type WindowTabs,
} from "./tab-model";
import { matchScreen, showsSame } from "./window-href";

/** What a tab shows, as the rule for where its links open reads it. */
export type PageType =
  | "builtIn"
  | "chat"
  | "file"
  | "folder"
  | "newTab"
  | "website";

/**
 * Which page types open what is clicked in them beside them
 * (`besidePlacementOf`), rather than in a new tab right after them in the
 * same side, as a browser does. Only a chat for now.
 */
export const OPENS_BESIDE = {
  builtIn: false,
  chat: true,
  file: false,
  folder: false,
  newTab: false,
  website: false,
} as const satisfies Record<PageType, boolean>;

/** What a tab shows (`PageType`). */
export function pageTypeOf(tab: WindowTab): PageType {
  if (tab.kind === "page") {
    return hostPathOfFileUrl(tab.url) === undefined ? "website" : "file";
  }
  if (chatOfTab(tab) !== undefined) {
    return "chat";
  }
  const computer = computerTabOf(tab.href);
  if (computer) {
    return computer.file === undefined ? "folder" : "file";
  }
  const screen = matchScreen(tab.href);
  return screen.kind === "inbox" ? "newTab" : "builtIn";
}

/** Whether what is clicked in a tab opens beside it (`OPENS_BESIDE`). */
export function opensBeside(tab: WindowTab): boolean {
  return OPENS_BESIDE[pageTypeOf(tab)];
}

/**
 * What the person did to open something in a chat: a plain click; a
 * Cmd-click (Ctrl-click off the Mac) or a middle click, which asks for a tab
 * that waits behind; or a menu's Open in New Tab, or a Shift-click.
 */
export type ChatGesture = "background" | "click" | "newTab";

/**
 * An open placed against a chat's tab: what the person opened in the chat
 * (`gesture`), or what the chat's agent opened (no `gesture`).
 */
export interface BesideAsk {
  /** The chat's tab it is placed against. */
  chatTab: string;
  /** What the person did; left out for what the chat's agent opens. */
  gesture?: ChatGesture;
  /**
   * An agent's open asked to be seen (`window show`). Its own working page
   * opened after the chat on the chat's side stays behind.
   */
  isShown?: boolean;
  /** The agent's last page in the group, which its next one goes right after, in the same side. */
  previous?: string;
}

/** Where an open beside a chat lands (`besidePlacementOf`). */
export type BesidePlacement =
  /** In place of the other side's only tab, an unwritten New Tab, with no history behind it. */
  | { kind: "replace"; tab: string }
  /** A new tab on a side, right after a tab or at the side's end; up there when `front`. */
  | { after: string | undefined; front: boolean; kind: "insert"; side: 0 | 1 }
  /** The tab on the other side already showing the same thing, brought up. */
  | { kind: "show"; tab: string };

/**
 * Whether two tabs show the same thing, as a click from a chat reads it: the
 * same chat, file, folder or one-of-a-kind screen (`showsSame`), or a web
 * page at exactly the same address.
 */
export function showsSameThing(a: WindowTab, b: WindowTab): boolean {
  if (a.kind === "page" && b.kind === "page") {
    return a.url !== undefined && a.url === b.url;
  }
  const fileOf = (tab: WindowTab) =>
    tab.kind === "page"
      ? hostPathOfFileUrl(tab.url)
      : computerTabOf(tab.href)?.file;
  if (a.kind !== b.kind) {
    const file = fileOf(a);
    return file !== undefined && file === fileOf(b);
  }
  return a.kind === "screen" && b.kind === "screen" && showsSame(a.href, b.href);
}

/**
 * Where something the person opens in a chat lands, as a browser would put
 * it, with one exception:
 *
 * - A plain click in a chat on the left side (or the only side) opens on the
 *   right side, made where there is none, in place of an unwritten New Tab
 *   that is all that side has, else right after the tab up there; a tab
 *   there already showing the same thing (`showsSameThing`) comes up instead.
 * - Everything else is a new tab right after the chat's tab, in its side:
 *   in front, except for a Cmd-click or a middle click, which waits behind.
 */
export function personPlacementOf(
  layout: GroupLayout,
  { chatTab, gesture }: { chatTab: string; gesture: ChatGesture },
  opening: WindowTab,
): BesidePlacement {
  const chatSide = sideIndexOf(layout, chatTab) ?? 0;
  if (gesture !== "click" || chatSide === 1) {
    return {
      after: chatTab,
      front: gesture !== "background",
      kind: "insert",
      side: chatSide,
    };
  }
  const right = layout.sides.length === 2 ? (layout.sides[1]?.tabs ?? []) : [];
  const same = right.find((tab) => showsSameThing(tab, opening));
  if (same !== undefined) {
    return { kind: "show", tab: same.id };
  }
  const only = right.length === 1 ? right[0] : undefined;
  if (only !== undefined && isHomeTab(only)) {
    return { kind: "replace", tab: only.id };
  }
  return {
    after: layout.sides.length === 2 ? layout.sides[1]?.up : undefined,
    front: true,
    kind: "insert",
    side: 1,
  };
}

/**
 * Where what a chat's agent opens lands: a page it opens, or what it shows.
 * Never in place of the chat, and never to its left.
 *
 * - Its later pages go right after its previous one, in that side.
 * - Chat on the right: right after the chat, in its side.
 * - Chat on the left, or alone: the other side, made when there is none,
 *   in place of an unwritten New Tab that is all that side has, else as that
 *   side's last tab.
 *
 * It comes to the front on the chat's side only when shown, and on the
 * other side unless the keyboard is there.
 */
export function agentPlacementOf(
  layout: GroupLayout,
  { chatTab, isShown = false, previous }: BesideAsk,
): BesidePlacement {
  const chatSide = sideIndexOf(layout, chatTab) ?? 0;
  const isFront = (side: 0 | 1) =>
    side === chatSide ? isShown : layout.focused !== side;
  // Never to the left of a chat on the right, wherever the last page went:
  // not on the left, and not before the chat in its own strip.
  const after =
    previous === undefined ? undefined : sideIndexOf(layout, previous);
  const strip = layout.sides[chatSide]?.tabs ?? [];
  const isBeforeChat =
    after === chatSide &&
    strip.findIndex((tab) => tab.id === previous) <
      strip.findIndex((tab) => tab.id === chatTab);
  if (
    previous !== undefined &&
    after !== undefined &&
    after >= chatSide &&
    !(chatSide === 1 && isBeforeChat)
  ) {
    return {
      after: previous,
      front: isFront(after),
      kind: "insert",
      side: after,
    };
  }
  if (layout.sides.length === 1) {
    return { after: undefined, front: true, kind: "insert", side: 1 };
  }
  if (chatSide === 1) {
    return { after: chatTab, front: isFront(1), kind: "insert", side: 1 };
  }
  const right = layout.sides[1]?.tabs ?? [];
  const only = right.length === 1 ? right[0] : undefined;
  if (only !== undefined && isHomeTab(only)) {
    return { kind: "replace", tab: only.id };
  }
  return {
    after: right.at(-1)?.id,
    front: isFront(1),
    kind: "insert",
    side: 1,
  };
}

/** Where an open from a chat lands: the person's (`personPlacementOf`) or the agent's (`agentPlacementOf`). */
export function besidePlacementOf(
  layout: GroupLayout,
  ask: BesideAsk,
  opening: WindowTab,
): BesidePlacement {
  return ask.gesture === undefined
    ? agentPlacementOf(layout, ask)
    : personPlacementOf(
        layout,
        { chatTab: ask.chatTab, gesture: ask.gesture },
        opening,
      );
}

/**
 * The agent's last tab in a group: of the tabs its chat opened there, the
 * last in strip order, since each opens right after the one before.
 */
export function previousOpenedIn(
  state: WindowTabs,
  group: string,
  chat: string,
): string | undefined {
  return state.tabs.findLast(
    (tab) => tab.group === group && tab.openedBy === chat,
  )?.id;
}

/**
 * A tab opened from a chat's tab, where `besidePlacementOf` puts it: the
 * one function every open from a chat goes through, the person's and the
 * agent's. Answers the tab that shows it (a tab already showing it, on a
 * plain click beside the chat) and whether it is up on its side. What the
 * person opens in front takes the keyboard to its side; a Cmd-click or a
 * middle click, and anything an agent opens (`openedBy`), never moves the
 * keyboard. Nothing happens for a chat's tab no group has.
 */
export function openBesideChat(
  state: WindowTabs,
  tab: WindowTab,
  ask: BesideAsk,
): { front: boolean; id: string; state: WindowTabs } {
  const group = state.tabs.find((entry) => entry.id === ask.chatTab)?.group;
  if (group === undefined) {
    return { front: false, id: tab.id, state };
  }
  const layout = groupLayoutOf(state, group);
  const { side: _side, ...placed } = { ...tab, group };
  const placement = besidePlacementOf(layout, ask, placed);
  let next: WindowTabs;
  let id = tab.id;
  if (placement.kind === "show") {
    id = placement.tab;
    next = state;
  } else if (placement.kind === "replace") {
    next = replaceTab(state, placement.tab, placed);
  } else {
    next = openInGroup(state, placed, {
      ...(placement.after === undefined ? {} : { after: placement.after }),
      group,
      side: placement.side,
    });
    if (placement.front) {
      next = raiseTab(next, tab.id);
    }
  }
  if (ask.gesture !== undefined && ask.gesture !== "background") {
    next = selectTab(next, id);
  }
  const after = groupLayoutOf(next, group);
  const front = after.sides.some((side) => side.up === id);
  return { front, id, state: next };
}
