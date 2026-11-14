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
  sideIndexOf,
  type WindowTabs,
} from "./tab-model";
import { matchScreen } from "./window-href";

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
  return screen.kind === "newTab" || screen.kind === "inbox"
    ? "newTab"
    : "builtIn";
}

/** Whether what is clicked in a tab opens beside it (`OPENS_BESIDE`). */
export function opensBeside(tab: WindowTab): boolean {
  return OPENS_BESIDE[pageTypeOf(tab)];
}

/** An open placed against a chat's tab, as a click inside the chat. */
export interface BesideAsk {
  /** Never comes to the front: a Cmd-click, a middle click, Open in New Tab. */
  behind: boolean;
  /** The chat's tab it is placed against. */
  chatTab: string;
  /**
   * Asked to be seen: a person's click, or the agent's `window show`. An
   * agent's own working page opened after the chat on the chat's side stays
   * behind.
   */
  isShown: boolean;
  /** The agent's last page in the group, which its next one goes right after, in the same side. */
  previous?: string;
}

/** Where an open beside a chat lands (`besidePlacementOf`). */
export type BesidePlacement =
  /** In place of the other side's only tab, an unwritten New Tab, with no history behind it. */
  | { kind: "replace"; tab: string }
  /** A new tab on a side, right after a tab or at the side's end; up there when `front`. */
  | { after: string | undefined; front: boolean; kind: "insert"; side: 0 | 1 };

/**
 * Where something opened from a chat lands: a link the person clicks in it,
 * a page its agent opens, or what the agent shows. Never in place of the
 * chat, and never to its left.
 *
 * - The agent's later pages go right after its previous one, in that side.
 * - Chat on the right: right after the chat, in its side.
 * - Chat on the left, or alone: the other side, made when there is none,
 *   in place of an unwritten New Tab that is all that side has, else as that
 *   side's last tab.
 *
 * It comes to the front on the chat's side only when shown, and on the
 * other side unless the keyboard is there; never when asked to stay behind.
 */
export function besidePlacementOf(
  layout: GroupLayout,
  { behind, chatTab, isShown, previous }: BesideAsk,
): BesidePlacement {
  const chatSide = sideIndexOf(layout, chatTab) ?? 0;
  const isFront = (side: 0 | 1) =>
    !behind && (side === chatSide ? isShown : layout.focused !== side);
  // Never to the left of a chat on the right, wherever the last page went.
  const after =
    previous === undefined ? undefined : sideIndexOf(layout, previous);
  if (previous !== undefined && after !== undefined && after >= chatSide) {
    return {
      after: previous,
      front: isFront(after),
      kind: "insert",
      side: after,
    };
  }
  if (layout.sides.length === 1) {
    return { after: undefined, front: !behind, kind: "insert", side: 1 };
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
 * A tab opened beside a chat's tab, where `besidePlacementOf` puts it, and
 * whether it is up on its side afterward. Nothing happens for a chat's tab
 * no group has.
 */
export function openBesideChat(
  state: WindowTabs,
  tab: WindowTab,
  ask: BesideAsk,
): { front: boolean; state: WindowTabs } {
  const group = state.tabs.find((entry) => entry.id === ask.chatTab)?.group;
  if (group === undefined) {
    return { front: false, state };
  }
  const layout = groupLayoutOf(state, group);
  const placement = besidePlacementOf(layout, ask);
  const { side: _side, ...placed } = { ...tab, group };
  let next: WindowTabs;
  if (placement.kind === "replace") {
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
  const after = groupLayoutOf(next, group);
  const front = after.sides.some((side) => side.up === tab.id);
  return { front, state: next };
}
