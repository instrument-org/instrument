import { keptAtom } from "@/client/lib/kept-state";
import { atom } from "jotai";

/** Whether the sidebar of tab groups is out, the same in every window. */
export const sidebarOpenAtom = keptAtom<boolean>(
  "view",
  "tab-groups-sidebar-open.v1",
  true,
);

/** The project the sidebar's list stands in, in this window: none for every open group. */
export const sidebarProjectAtom = atom<string | undefined>(undefined);

/** The sidebar's narrowest, in CSS px: narrow enough to give two sides the room on a laptop screen. */
export const SIDEBAR_WIDTH_MIN = 200;
/** The sidebar's width until a drag sets one, in CSS px. */
export const SIDEBAR_WIDTH_DEFAULT = 320;
/** The sidebar's widest: a list to pick a group from, so the room past this goes to the group beside it. */
export const SIDEBAR_WIDTH_MAX = 440;

const storedSidebarWidthAtom = keptAtom<number>(
  "view",
  "tab-groups-sidebar-width.v1",
  SIDEBAR_WIDTH_DEFAULT,
);

/** The sidebar's width in CSS px, dragged by its right edge, and read within its widest whatever was stored. */
export const sidebarWidthAtom = atom(
  (get) => Math.min(get(storedSidebarWidthAtom), SIDEBAR_WIDTH_MAX),
  (_get, set, width: number) => {
    set(storedSidebarWidthAtom, width);
  },
);
