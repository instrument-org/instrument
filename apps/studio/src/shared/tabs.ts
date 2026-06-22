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

export interface TabState {
  selectedTabId: null | string;
  tabs: Tab[];
}

export const SingleTabOnlyRoutes = /\/tasks\/[^/]+/;

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
