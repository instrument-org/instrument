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

/** The sidebar's narrowest, and its width until a drag sets one, in CSS px. */
export const SIDEBAR_WIDTH_MIN = 320;
/** The sidebar's widest: a list to pick a group from, so the room past this goes to the group beside it. */
export const SIDEBAR_WIDTH_MAX = 440;

const storedSidebarWidthAtom = keptAtom<number>(
  "view",
  "tab-groups-sidebar-width.v1",
  SIDEBAR_WIDTH_MIN,
);

/** The sidebar's width in CSS px, dragged by its right edge, and read within its widest whatever was stored. */
export const sidebarWidthAtom = atom(
  (get) => Math.min(get(storedSidebarWidthAtom), SIDEBAR_WIDTH_MAX),
  (_get, set, width: number) => {
    set(storedSidebarWidthAtom, width);
  },
);

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
