import { keptAtom } from "@/client/lib/kept-state";
import { draftOfGroup } from "@/shared/drafts";
import { atom } from "jotai";

/** Whether the sidebar of tab groups is out, the same in every window. */
export const sidebarOpenAtom = keptAtom<boolean>(
  "view",
  "tab-groups-sidebar-open.v1",
  true,
);

/** The groups whose chat column is closed (true) or open (false), by group; a group named in neither takes `isChatClosed`'s default. */
export const chatClosedByGroupAtom = keptAtom<Record<string, boolean>>(
  "view",
  "tab-groups-chat-closed.v1",
  {},
);

/**
 * Whether a group's chat column is closed: as set, else closed for a group
 * whose chat has not started, which has only a new chat's composer to show,
 * and open for a chat's.
 */
export function isChatClosed(
  group: string,
  closedByGroup: Record<string, boolean>,
): boolean {
  return closedByGroup[group] ?? draftOfGroup(group) !== undefined;
}

/** What the sidebar's list shows in this window: the open groups, or History. */
export const sidebarViewAtom = atom<"history" | "list">("list");

/** The sidebar's search, in this window. */
export const groupSearchAtom = atom("");

/** The width of the sidebar, in CSS px. */
export const SIDEBAR_WIDTH = 256;

/** The chat column's share of the row beside a group's work, as the side pane kept its own. */
export const CHAT_DEFAULT_SHARE = 0.3;

export const chatShareAtom = keptAtom<number>(
  "view",
  "tab-groups-chat-share.v1",
  CHAT_DEFAULT_SHARE,
);
