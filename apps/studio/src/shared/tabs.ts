import { APP_NAME_SLUG } from "@instrument-org/shared";
import { type TabIconName } from "@instrument-org/shared/icons";
import { type TaskId } from "@instrument-org/workspace/client";

export interface Tab {
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
  | { type: "selectPrevious" };

export interface TabState {
  selectedTabId: null | string;
  tabs: Tab[];
}

export const META_TAGS = {
  iconName: `${APP_NAME_SLUG}-icon-name`,
  taskId: `${APP_NAME_SLUG}-task-id`,
};

export function createIconMeta(icon: TabIconName) {
  return {
    content: icon,
    name: META_TAGS.iconName,
  };
}

export function createTaskIdMeta(id: TaskId) {
  return {
    content: id,
    name: META_TAGS.taskId,
  };
}
