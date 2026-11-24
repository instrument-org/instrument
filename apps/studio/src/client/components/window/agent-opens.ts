import { settingsHrefOf } from "@/client/components/settings/settings-href";
import { settingsTargetOf } from "@/client/components/settings/settings-index";
import { isScreenName, SCREENS } from "@/shared/instrument-screens";
import { instrumentLinkOf } from "@instrument-org/shared";

/**
 * Where what an agent opens may go. An agent never makes a tab group: its
 * pages go only into the group of its chat's tab, beside that tab
 * (`besidePlacementOf`), and with no such tab nothing opens.
 */

/** Why an agent's open did nothing, for a chat with no tab in any open group. */
export const NO_CHAT_TAB =
  "the user closed this chat's tab, so nothing opened. Your pages open only in your chat's tab group, and it has one again once the user opens the chat.";

/** Why an ask from outside any chat opened nothing. */
export const NO_CHAT = "only a chat's agent opens tabs, so nothing opened.";

/**
 * The tab an agent's open goes beside: its chat's working tab
 * (`workingTabOf`), or why nothing opens, never a new group.
 */
export function agentChatTabOf<C extends string>(
  chat: C | undefined,
  workingTab: (chat: C) => { group: string; id: string } | undefined,
): { error: string } | { after: string; group: string } {
  if (chat === undefined) {
    return { error: NO_CHAT };
  }
  const tab = workingTab(chat);
  return tab === undefined
    ? { error: NO_CHAT_TAB }
    : { after: tab.id, group: tab.group };
}

/**
 * Where a tab a page asked for opens (a `target=_blank` link, a sign-in
 * popup, the page's menu): right after the page, in its group, or nowhere
 * for an agent's popup from a page with no tab, which has no group to go
 * in. `free` is the person's own open from a page outside any group, which
 * opens as anything else they open would.
 */
export function pageOpenPlaceOf(
  asking: { group?: string; id: string } | undefined,
  { isAgent }: { isAgent: boolean },
):
  | { after: string; group: string; kind: "after" }
  | { kind: "free" }
  | { kind: "none" } {
  if (asking?.group !== undefined) {
    return { after: asking.id, group: asking.group, kind: "after" };
  }
  return isAgent ? { kind: "none" } : { kind: "free" };
}

/**
 * The tab address an agent's `instrument://` address opens at: a chat, an
 * app, a task, a built-in page, a part of Settings or a single setting,
 * which is its part with the row to light. Undefined for one that names no
 * tab: a memory, a skill or a project opens outside the tabs.
 */
export function tabHrefOfAppAddress(address: string): string | undefined {
  const link = instrumentLinkOf(address);
  switch (link?.kind) {
    case "app":
    case "chat":
    case "task": {
      return link.href;
    }
    case "screen": {
      if (!isScreenName(link.name)) {
        return undefined;
      }
      const screen = SCREENS[link.name];
      return "href" in screen ? screen.href : undefined;
    }
    case "settings": {
      // A name Settings has no row or part for is words to search for, which
      // is no tab to open.
      return settingsTargetOf(link.name).kind === "search"
        ? undefined
        : settingsHrefOf({ setting: link.name });
    }
    default: {
      return undefined;
    }
  }
}

/** Why an `instrument://` address opened no tab. */
export function noTabAt(address: string): string {
  return `${address} names no tab: a chat, an app, a task, a built-in page, a part of Settings or a setting opens as one, by the address \`instrument window list\` prints.`;
}
