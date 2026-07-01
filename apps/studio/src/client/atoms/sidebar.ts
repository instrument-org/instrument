import { SIDEBAR_WIDTH } from "@/shared/constants";
import { atomWithStorage } from "jotai/utils";

const SIDEBAR_WIDTH_MIN = 200;
const SIDEBAR_WIDTH_MAX = 480;

// Dragging the handle left of this (below the min) on release collapses the
// sidebar rather than pinning it to the min width.
export const SIDEBAR_COLLAPSE_THRESHOLD = 160;

/**
 * Whether the sidebar rail is open. Renderer-owned view state, persisted across
 * launches; `getOnInit` reads storage before first paint so the rail doesn't
 * flash open then close. The native Toggle Sidebar menu item drives this through
 * a main-process signal rather than owning the state itself.
 */
export const sidebarOpenAtom = atomWithStorage<boolean>(
  "studio.sidebar-open.v1",
  true,
  undefined,
  { getOnInit: true },
);

/**
 * User-chosen sidebar width in CSS px, applied as the chrome rail's width and
 * persisted across launches. `getOnInit` reads storage before first paint so the
 * rail doesn't flash the default width.
 */
export const sidebarWidthAtom = atomWithStorage<number>(
  "studio.sidebar-width.v1",
  SIDEBAR_WIDTH,
  undefined,
  { getOnInit: true },
);

export function clampSidebarWidth(value: number) {
  return Math.min(
    SIDEBAR_WIDTH_MAX,
    Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)),
  );
}
