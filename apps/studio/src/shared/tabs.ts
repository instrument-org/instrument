import { APP_NAME_SLUG } from "@instrument-org/shared";
import { type TabIconName } from "@instrument-org/shared/icons";
import { type TaskId } from "@instrument-org/workspace/client";

export interface Tab {
  iconName?: TabIconName;
  id: string;
  pathname: string;
  pinned?: boolean;
  projectSubdomain?: TaskId;
  tabBarHidden?: boolean;
  title?: string;
}

export interface TabState {
  selectedTabId: null | string;
  tabs: Tab[];
}

export const SingleTabOnlyRoutes = /\/tasks\/[^/]+|\/sign-in/;

export const META_TAGS = {
  iconName: `${APP_NAME_SLUG}-icon-name`,
  projectSubdomain: `${APP_NAME_SLUG}-project-subdomain`,
};

export function createIconMeta(icon: TabIconName) {
  return {
    content: icon,
    name: META_TAGS.iconName,
  };
}

export function createProjectSubdomainMeta(subdomain: TaskId) {
  return {
    content: subdomain,
    name: META_TAGS.projectSubdomain,
  };
}
