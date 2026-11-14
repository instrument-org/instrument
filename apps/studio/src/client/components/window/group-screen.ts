import { matchScreen } from "./window-href";

/**
 * Whether a tab in a chat's or a draft's group can stand at an address: the
 * computer, a chat's tasks or one task, the web's start, the new tab, the
 * apps or one app's front, the built-in pages (Settings, Memory, Skills,
 * History, Activity), the release notes and the extensions. Anything else
 * the window shows (the debug pages) is the window's own and never a tab of
 * a group, so an address outside this list opens at the window's level and
 * a stored tab at one is dropped.
 */
export function isGroupScreenHref(href: string): boolean {
  switch (matchScreen(href).kind) {
    case "activity":
    case "app":
    case "apps":
    case "browser":
    case "computer":
    case "extensions":
    case "history":
    case "memories":
    case "newTab":
    case "releaseNotes":
    case "settings":
    case "skills":
    case "task": {
      return true;
    }
    default: {
      return false;
    }
  }
}
