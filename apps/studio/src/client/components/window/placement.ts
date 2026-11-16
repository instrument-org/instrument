import { type ChatGesture } from "./beside-chat";
import { type OpenOptions } from "./context";
import { isGroupScreenHref } from "./group-screen";
import { matchScreen } from "./window-href";

/**
 * Where an open lands, decided from the ask and the window as it stands,
 * before anything is opened. `useOpeners` applies the answer.
 */
export interface PlacementContext {
  /** The group on screen: the chat's id or the site's key the window's tab up stands on. */
  groupOnScreen: string | undefined;
  /** Whether the group on screen is a chat, whose tabs are beside it in a pane. */
  isChatOnScreen: boolean;
  /** The tab the group on screen has up. */
  up:
    | undefined
    | {
        /** Still its group's own new tab, standing where it opened. */
        isFresh: boolean;
        kind: "page" | "screen";
      };
}

export type PagePlacement =
  /** A tab of the window's own, the site its page. */
  | { behind: boolean; kind: "window-tab" }
  /** Into a group not on screen, waiting there; brought on screen when shown. */
  | { activate: boolean; group: string; kind: "group-behind"; show: boolean }
  /** A tab of its own right after the one up in the group on screen, waiting behind it when asked. */
  | { behind: boolean; kind: "group-new-tab" }
  /** No group on screen: the window's tab up goes to the site, a step on, or in place of a screen handing its file over. */
  | { kind: "window-site"; replace: boolean }
  /** The page up in the group on screen goes to the address. */
  | { kind: "navigate-up" }
  /** A tab of its own in the group on screen, or the file's tab already there. */
  | { kind: "own-tab" }
  /** A new page in the group on screen, in the up tab's place when it gives its place up. */
  | { kind: "new-page"; replacesUp: boolean };

/**
 * Where a page opens: asked for in a new tab, right after the tab up in
 * the group on screen, or a window tab of its own with no group on screen;
 * into a group other than the one on screen, waiting there; as a site in the window's tab
 * up when no group is on screen; otherwise in the group on screen, where the
 * page up goes there, or a tab of its own is opened (a website again however
 * many tabs are on it, a file's tab brought forward), or the new page takes
 * the place of the tab up.
 */
export function pagePlacementOf(
  {
    activate = false,
    behind = false,
    group: into,
    newTab = false,
    ownTab = false,
    replace = false,
    show = false,
  }: OpenOptions,
  { groupOnScreen, up }: PlacementContext,
): PagePlacement {
  if (newTab) {
    if (groupOnScreen === undefined) {
      return { behind, kind: "window-tab" };
    }
    return into === undefined || into === groupOnScreen
      ? { behind, kind: "group-new-tab" }
      : { activate: !behind, group: into, kind: "group-behind", show: false };
  }
  if (into !== undefined && into !== groupOnScreen) {
    return { activate, group: into, kind: "group-behind", show };
  }
  if (groupOnScreen === undefined) {
    return { kind: "window-site", replace };
  }
  if (!ownTab && up?.kind === "page") {
    return { kind: "navigate-up" };
  }
  const isFresh = up?.isFresh ?? false;
  if (ownTab && !isFresh) {
    return { kind: "own-tab" };
  }
  return {
    kind: "new-page",
    replacesUp: up !== undefined && (!ownTab || isFresh),
  };
}

export type ScreenPlacement =
  /** A tab of the window's own at the address. */
  | { behind: boolean; kind: "window-tab" }
  /** The window's tab up goes to the address, a step on. */
  | { kind: "window-navigate" }
  /** Into a group not on screen, waiting there; brought on screen when shown. */
  | { group: string; kind: "group-behind"; select: boolean; show: boolean }
  /** A tab of its own right after the one up in the group on screen, waiting behind it when asked. */
  | { behind: boolean; kind: "group-new-tab" }
  /** A tab of the group on screen, opened beside none: it has nothing up to stand in place of. */
  | { kind: "group-open" }
  /** A tab of its own in the group on screen, or the one already at the address. */
  | { kind: "group-own-tab" }
  /** The group on screen's tab up goes to the address, a step on. */
  | { kind: "group-navigate" };

/**
 * Where a screen opens (a chat, a memory, a skill and a chat's tasks are
 * placed before this): the window's tab up for an app not asked for in a tab of its own, and for any screen no
 * group's tab stands on (the release notes); asked for in a new tab, right
 * after the tab up in the group on screen, or a window tab of its own with
 * no group on screen; into a group other than the one on screen, waiting there;
 * the window's tab up outside a chat; otherwise in the chat on screen, where
 * the tab up goes there, or a tab of its own opens, or one opens with
 * nothing up.
 */
export function screenPlacementOf(
  href: string,
  {
    activate = false,
    behind = false,
    group: into,
    newTab = false,
    ownTab = false,
    show = false,
  }: OpenOptions,
  { groupOnScreen, isChatOnScreen, up }: PlacementContext,
): ScreenPlacement {
  // An app comes up where it already is, unless asked for in a tab of its own.
  if (
    !isGroupScreenHref(href) ||
    (matchScreen(href).kind === "app" && !newTab)
  ) {
    return { kind: "window-navigate" };
  }
  if (newTab) {
    if (groupOnScreen === undefined) {
      return { behind, kind: "window-tab" };
    }
    return into === undefined || into === groupOnScreen
      ? { behind, kind: "group-new-tab" }
      : { group: into, kind: "group-behind", select: !behind, show: false };
  }
  if (into !== undefined && into !== groupOnScreen) {
    return {
      group: into,
      kind: "group-behind",
      select: activate || show,
      show,
    };
  }
  if (!isChatOnScreen) {
    return { kind: "window-navigate" };
  }
  if (!up) {
    return { kind: "group-open" };
  }
  return ownTab && !up.isFresh
    ? { kind: "group-own-tab" }
    : { kind: "group-navigate" };
}

/**
 * An open as it lands inside the window, where only a menu's Open in New Tab
 * Group or Open in New Window (`into`) makes a group: a Shift-click's window
 * of its own is a new tab in front.
 */
export function inGroup(options: OpenOptions): OpenOptions {
  const { newWindow, ...rest } = options;
  return newWindow === true ? { ...rest, behind: false, newTab: true } : rest;
}

/**
 * What the person did, read from an open's options: a tab asked to wait
 * behind (a Cmd-click, a middle click), a new tab asked for in front (Open
 * in New Tab, a Shift-click), or a plain click.
 */
export function gestureOf(options: OpenOptions): ChatGesture {
  if (options.behind === true) {
    return "background";
  }
  return options.newTab === true || options.newWindow === true
    ? "newTab"
    : "click";
}

/** Where a chat opened from inside the window goes (`chatPlacementOf`). */
export type ChatPlacement =
  /** From the chat it was clicked in (`openBesideChat`). */
  | { chatTab: string; gesture: ChatGesture; kind: "beside" }
  /** Right after the tab it was clicked in, which is no chat. */
  | { after: string; behind: boolean; group: string; kind: "after" }
  /** Right after the tab up in the group on screen. */
  | { behind: boolean; kind: "group-new-tab" }
  /** The place a menu's Open in Split, New Tab Group or New Window picked. */
  | { into: "group" | "split" | "window"; kind: "menu" }
  /** A group of its own, for a window with no group up to put a tab in. */
  | { kind: "own-group" };

/**
 * Where a chat opened from inside the window goes: a tab, never a group of
 * its own unless a menu asked for one or the window has no group up. From
 * the chat it was clicked in (`place`, from `OpenOptions.chat`) by the
 * person's gesture, else right after the tab up, in front unless asked to
 * wait behind.
 */
export function chatPlacementOf(
  asked: OpenOptions,
  place: undefined | { after: string; group: string; isBeside: boolean },
  { groupOnScreen }: Pick<PlacementContext, "groupOnScreen">,
): ChatPlacement {
  if (asked.into) {
    return { into: asked.into, kind: "menu" };
  }
  const behind = asked.behind === true;
  if (place?.isBeside === true) {
    return { chatTab: place.after, gesture: gestureOf(asked), kind: "beside" };
  }
  if (place !== undefined) {
    return { after: place.after, behind, group: place.group, kind: "after" };
  }
  return groupOnScreen === undefined
    ? { kind: "own-group" }
    : { behind, kind: "group-new-tab" };
}
