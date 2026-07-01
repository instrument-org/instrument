import { type TabIconName } from "@instrument-org/shared/icons";
import { type TaskId } from "@instrument-org/workspace/client";

export interface Tab {
  history?: TabHistory;
  iconName?: TabIconName;
  id: string;
  pathname: string;
  pinned?: boolean;
  tabBarHidden?: boolean;
  taskId?: TaskId;
  title?: string;
}

/**
 * A tab operation sent from the main process (menus, overlay-initiated RPC) to
 * the renderer that owns tab state (AppShell). `navigate` with `newTab` opens a
 * new tab; without it, the active tab navigates. `close` without `id` closes the
 * active tab.
 */
export type TabCommand =
  | { appPath: string; newTab?: boolean; type: "navigate" }
  | { id?: string; type: "close" }
  | { index: number; type: "selectByIndex" }
  | { type: "navigateBack" }
  | { type: "navigateForward" }
  | { type: "reopen" }
  | { type: "selectLast" }
  | { type: "selectNext" }
  | { type: "selectPrevious" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "zoomReset" };

// A tab's memory-history stack, captured on close so reopening restores the
// tab's back/forward history, not just its last location.
export interface TabHistory {
  entries: string[];
  index: number;
}

export interface TabState {
  selectedTabId: null | string;
  tabs: Tab[];
}
