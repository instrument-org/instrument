import {
  APPS_HREF,
  BROWSER_HREF,
  NEW_TAB_HREF,
  type WindowTabs,
} from "@/client/atoms/window";
import { type StoreId, type TaskId } from "@instrument-org/workspace/client";

import { computerTabOf } from "./file-tabs";
import { tasksOfHref } from "./tab-location";
import { parseHref } from "./window-tabs";

/**
 * A screen a tab in a chat's or a draft's group can stand on, which is
 * every screen the group's view (`GroupItem`) draws. Anything else the window
 * shows (Discover, the release notes, the debug pages, Settings) is the
 * window's own and never a tab of a group, so an address outside this list
 * opens at the window's level and a stored tab at one is dropped.
 */
export type GroupScreen =
  | { kind: "app"; slug: string }
  | { kind: "apps" }
  | { kind: "browser" }
  | { chat?: StoreId.Session; kind: "tasks"; task?: TaskId }
  | {
      file?: string;
      kind: "computer";
      path: string;
      root: string;
      tree?: string;
    }
  | { kind: "newTab" };

/** The group screen an address names, or undefined for one no group's tab stands on. */
export function groupScreenOf(href: string): GroupScreen | undefined {
  const computer = computerTabOf(href);
  if (computer) {
    return { kind: "computer", ...computer };
  }
  const tasks = tasksOfHref(href);
  if (tasks) {
    return { kind: "tasks", ...tasks };
  }
  const { pathname } = parseHref(href);
  if (pathname === BROWSER_HREF) {
    return { kind: "browser" };
  }
  if (pathname === NEW_TAB_HREF) {
    return { kind: "newTab" };
  }
  if (pathname === APPS_HREF) {
    return { kind: "apps" };
  }
  if (pathname.startsWith(`${APPS_HREF}/`)) {
    const slug = pathname.slice(APPS_HREF.length + 1);
    return slug && !slug.includes("/") ? { kind: "app", slug } : undefined;
  }
  return undefined;
}

/**
 * The tabs without any screen tab no group may hold, for tabs kept from a
 * build that let one in. A screen tab's trail goes with it: a step back
 * onto such a screen would be one again.
 */
export function withGroupScreensOnly(current: WindowTabs): WindowTabs {
  const tabs = current.tabs.filter(
    (tab) =>
      tab.kind !== "screen" ||
      (tab.trail ?? [tab.href]).every(
        (href) => groupScreenOf(href) !== undefined,
      ),
  );
  return tabs.length === current.tabs.length ? current : { ...current, tabs };
}
