import { keptAtom } from "@/client/lib/kept-state";
import { atom } from "jotai";

/** Whether the sidebar of tab groups is out, the same in every window. */
export const sidebarOpenAtom = keptAtom<boolean>(
  "view",
  "tab-groups-sidebar-open.v1",
  true,
);

/**
 * The groups whose chat column is closed by its X, by group. Every other
 * group's column is open, so a tab added to a group shows its chat beside it.
 */
export const chatClosedByGroupAtom = keptAtom<Record<string, true>>(
  "view",
  "tab-groups-chat-closed.v2",
  {},
);

/** What the sidebar's list shows in this window: the open groups, or History. */
export const sidebarViewAtom = atom<"history" | "list">("list");

/** The sidebar's search, in this window. */
export const groupSearchAtom = atom("");

/** The width of the sidebar, in CSS px. */
export const SIDEBAR_WIDTH = 256;

/**
 * The chat column's share of the row beside a group's work until a drag
 * sets one: none, which the column's floor (`PANE_WIDTH_MIN`) holds at its
 * narrowest.
 */
export const CHAT_DEFAULT_SHARE = 0;

export const chatShareAtom = keptAtom<number>(
  "view",
  "tab-groups-chat-share.v2",
  CHAT_DEFAULT_SHARE,
);
