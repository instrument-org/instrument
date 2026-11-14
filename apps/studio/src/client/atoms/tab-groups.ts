import { keptAtom } from "@/client/lib/kept-state";
import { atom } from "jotai";

/** Whether the sidebar of tab groups is out, the same in every window. */
export const sidebarOpenAtom = keptAtom<boolean>(
  "view",
  "tab-groups-sidebar-open.v1",
  true,
);

/**
 * The names the person gave tab groups, by group. A row shows its group's
 * name over its own title (its first chat's title, or its tab up's). Only
 * the person names a group: the name and a chat's title never set each
 * other.
 */
export const groupNamesAtom = keptAtom<Record<string, string>>(
  "view",
  "tab-groups-names.v1",
  {},
);

/** The groups the person pinned above the line, by group. A chat's star is the chat's own, and pins nothing. */
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
 * The left side's share of each group of two sides, by group: its share of
 * the row past the gutter, kept as a share so it holds as the window or the
 * sidebar changes width. A group with none splits in half.
 */
export const sideShareByGroupAtom = keptAtom<Record<string, number>>(
  "view",
  "tab-groups-side-share.v1",
  {},
);
