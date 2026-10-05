import { APPS_HREF } from "@/client/atoms/window";
import { type StoreId } from "@instrument-org/workspace/client";

import { type OpenOptions } from "./context";
import { isGroupScreenHref } from "./group-screen";
import { tasksOfHref } from "./tab-location";
import { parseHref } from "./window-href";

/**
 * Where an open lands, decided from the ask and the window as it stands,
 * before anything is opened. `useOpeners` applies the answer.
 */
export interface PlacementContext {
  /** The group on screen: the chat's session or the site's key the window's tab up stands on. */
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
        /** A task's page, driven by the task: never given up in place. */
        isTasks: boolean;
      };
}

export type PagePlacement =
  /** A tab of the window's own, the site its page. */
  | { behind: boolean; kind: "window-tab" }
  /** Into a group not on screen, waiting there; brought on screen when shown. */
  | { activate: boolean; group: string; kind: "group-behind"; show: boolean }
  /** No group on screen: the window's tab up goes to the site, a step on, or in place of a screen handing its file over. */
  | { kind: "window-site"; replace: boolean }
  /** The page up in the group on screen goes to the address. */
  | { kind: "navigate-up" }
  /** A tab of its own in the group on screen, or the file's tab already there. */
  | { kind: "own-tab" }
  /** A new page in the group on screen, in the up tab's place when it gives its place up. */
  | { kind: "new-page"; replacesUp: boolean };

/**
 * Where a page opens: a window tab of its own when asked; into a group
 * other than the one on screen, waiting there; as a site in the window's tab
 * up when no group is on screen; otherwise in the group on screen, where the
 * page up goes there, or a tab of its own is opened (a website again however
 * many tabs are on it, a file's tab brought forward), or the new page takes
 * the place of the tab up. A task's tab is the task's, so it never gives its
 * place up.
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
    return { behind, kind: "window-tab" };
  }
  if (into !== undefined && into !== groupOnScreen) {
    return { activate, group: into, kind: "group-behind", show };
  }
  if (groupOnScreen === undefined) {
    return { kind: "window-site", replace };
  }
  if (!ownTab && up?.kind === "page" && !up.isTasks) {
    return { kind: "navigate-up" };
  }
  const isFresh = up?.isFresh ?? false;
  if (ownTab && !isFresh) {
    return { kind: "own-tab" };
  }
  return {
    kind: "new-page",
    replacesUp: up !== undefined && !up.isTasks && (!ownTab || isFresh),
  };
}

export type ScreenPlacement =
  /** A tab of the window's own at the address. */
  | { behind: boolean; kind: "window-tab" }
  /** The window's tab up goes to the address, a step on. */
  | { kind: "window-navigate" }
  /** Into a group not on screen, waiting there; brought on screen when shown. */
  | { group: string; kind: "group-behind"; select: boolean; show: boolean }
  /** A tab of the group on screen, opened beside none: it has nothing up to stand in place of. */
  | { kind: "group-open" }
  /** A tab of its own in the group on screen, or the one already at the address. */
  | { kind: "group-own-tab" }
  /** The group on screen's tab up goes to the address, a step on. */
  | { kind: "group-navigate" };

/**
 * Where a screen opens (a chat, a memory, a skill and a chat's tasks are
 * placed before this): a window tab of its own when asked; the window's tab
 * up for an app and for any screen no group's tab stands on (Discover, the
 * release notes); into a group other than the one on screen, waiting there;
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
  if (newTab) {
    return { behind, kind: "window-tab" };
  }
  if (
    parseHref(href).pathname.startsWith(`${APPS_HREF}/`) ||
    !isGroupScreenHref(href)
  ) {
    return { kind: "window-navigate" };
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

export type TasksPlacement =
  /** The chat's tab up already shows tasks, and walks there in place. */
  | { kind: "in-place" }
  /** The chat's tab at the address, or a new one, up in the chat, which comes on screen first when it is not. */
  | { kind: "in-chat"; navigatesWindow: boolean };

/**
 * Where a chat's tasks, or one task, open: a tasks tab already up in the
 * chat on screen walks there in place; anything else gets the chat's tab at
 * that address or a new one, with the chat brought on screen in the
 * window's tab up (or a tab of its own when asked) when it is not there.
 */
export function tasksPlacementOf(
  owner: StoreId.Session,
  { newTab = false, ownTab = false }: OpenOptions,
  {
    groupOnScreen,
    upInOwner,
  }: {
    groupOnScreen: string | undefined;
    /** The address of the screen the owning chat has up, when it has a screen up. */
    upInOwner: string | undefined;
  },
): TasksPlacement {
  const walksInPlace =
    !newTab &&
    !ownTab &&
    owner === groupOnScreen &&
    upInOwner !== undefined &&
    tasksOfHref(upInOwner) !== undefined;
  if (walksInPlace) {
    return { kind: "in-place" };
  }
  return {
    kind: "in-chat",
    navigatesWindow: newTab || owner !== groupOnScreen,
  };
}
