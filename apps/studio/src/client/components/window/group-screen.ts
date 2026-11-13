import { type WindowTab } from "@/client/atoms/window";

import { matchScreen } from "./window-href";

/**
 * Whether a tab in a chat's or a draft's group can stand at an address: the
 * computer, a chat's tasks or one task, the web's start, the new tab, the
 * apps or one app's front, Activity, the release notes and the extensions.
 * Anything else the window shows (the debug pages, Settings) is the
 * window's own and never a tab of a group, so an address outside this list
 * opens at the window's level and a stored tab at one is dropped.
 */
export function isGroupScreenHref(href: string): boolean {
  switch (matchScreen(href).kind) {
    case "activity":
    case "app":
    case "apps":
    case "browser":
    case "computer":
    case "extensions":
    case "newTab":
    case "releaseNotes":
    case "task": {
      return true;
    }
    default: {
      return false;
    }
  }
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
