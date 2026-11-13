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
 * group's column is open, a new group's included.
 */
export const chatClosedByGroupAtom = keptAtom<Record<string, true>>(
  "view",
  "tab-groups-chat-closed.v2",
  {},
);

/**
 * The names the person gave tab groups, by group, a chat's or not. A row
 * shows its group's name over its own title (its chat's title, or what a
 * group whose chat has not started is called). Only the person names a
 * group: the name and the chat's title never set each other.
 */
export const groupNamesAtom = keptAtom<Record<string, string>>(
  "view",
  "tab-groups-names.v1",
  {},
);

/**
 * The groups whose chat has not started that the person pinned, by group. A
 * chat's group is pinned by the chat's star, which takes over from the pin
 * when the chat starts.
 */
export const groupPinsAtom = keptAtom<Record<string, true>>(
  "view",
  "tab-groups-pinned.v1",
  {},
);

/** A group thrown away, its name and pin with it, which nothing shows again. */
export const forgetGroupAtom = atom(null, (get, set, group: string) => {
  const names = get(groupNamesAtom);
  if (group in names) {
    const { [group]: _name, ...rest } = names;
    set(groupNamesAtom, rest);
  }
  const pins = get(groupPinsAtom);
  if (group in pins) {
    const { [group]: _pin, ...rest } = pins;
    set(groupPinsAtom, rest);
  }
});

/** What the sidebar's list shows in this window: the open groups, or History. */
export const sidebarViewAtom = atom<"history" | "list">("list");

/** The project the sidebar's list stands in, in this window: none for every open group. */
export const sidebarProjectAtom = atom<string | undefined>(undefined);

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
