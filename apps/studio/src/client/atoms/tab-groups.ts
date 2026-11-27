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

/** The side panel's narrowest, in CSS px. */
export const SIDE_PANEL_WIDTH_MIN = 240;
/** The side panel's width until a drag sets one, in CSS px. */
export const SIDE_PANEL_WIDTH_DEFAULT = 264;
/** The side panel's widest: past this the room goes to the group beside it. */
export const SIDE_PANEL_WIDTH_MAX = 440;

const storedSidePanelWidthAtom = keptAtom<number>(
  "view",
  "side-panel-width.v1",
  SIDE_PANEL_WIDTH_DEFAULT,
);

/** The side panel's width in CSS px, dragged by its left edge, the same in every window and group. */
export const sidePanelWidthAtom = atom(
  (get) => Math.min(get(storedSidePanelWidthAtom), SIDE_PANEL_WIDTH_MAX),
  (_get, set, width: number) => {
    set(storedSidePanelWidthAtom, width);
  },
);
