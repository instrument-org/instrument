import { matchScreen } from "./window-href";

/**
 * Whether a tab in a chat's or a draft's group can stand at an address: the
 * computer, a chat's tasks or one task, the web's start, the new tab, the
 * apps or one app's front, the built-in pages (Settings, Memory, Skills,
 * Chats, Activity), the release notes, the extensions and the debug pages,
 * and an address no screen answers, where the tab says the page isn't
 * there. The rest (a group, a chat, a site, a link address) are the
 * window's own to place.
 */
export function isGroupScreenHref(href: string): boolean {
  switch (matchScreen(href).kind) {
    case "activity":
    case "app":
    case "apps":
    case "bookmarks":
    case "browser":
    case "computer":
    case "debug":
    case "extensions":
    case "chats":
    case "memories":
    case "releaseNotes":
    case "settings":
    case "skills":
    case "task":
    case "unknown": {
      return true;
    }
    default: {
      return false;
    }
  }
}
