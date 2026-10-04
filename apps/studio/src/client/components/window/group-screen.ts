import {
  APPS_HREF,
  BROWSER_HREF,
  NEW_TAB_HREF,
  type WindowTab,
} from "@/client/atoms/window";

import { computerTabOf } from "./file-tabs";
import { tasksOfHref } from "./tab-location";
import { parseHref } from "./window-href";

/**
 * Whether a tab in a chat's or a draft's group can stand at an address: the
 * computer, a chat's tasks or one task, the web's start, the new tab, the
 * apps or one app's front. Anything else the window shows (Discover, the
 * release notes, the debug pages, Settings) is the window's own and never a
 * tab of a group, so an address outside this list opens at the window's
 * level and a stored tab at one is dropped.
 */
export function isGroupScreenHref(href: string): boolean {
  if (computerTabOf(href) || tasksOfHref(href)) {
    return true;
  }
  const { pathname } = parseHref(href);
  if (
    pathname === BROWSER_HREF ||
    pathname === NEW_TAB_HREF ||
    pathname === APPS_HREF
  ) {
    return true;
  }
  if (pathname.startsWith(`${APPS_HREF}/`)) {
    const slug = pathname.slice(APPS_HREF.length + 1);
    return slug !== "" && !slug.includes("/");
  }
  return false;
}

/**
 * The tabs without any screen tab no group may hold, for tabs kept from a
 * build that let one in. A screen tab's history goes with it: a step back
 * onto such a screen would be one again.
 */
export function groupScreenTabsOnly(tabs: WindowTab[]): WindowTab[] {
  return tabs.filter(
    (tab) =>
      tab.kind !== "screen" ||
      (tab.history?.entries ?? [tab.href]).every((href) =>
        isGroupScreenHref(href),
      ),
  );
}
