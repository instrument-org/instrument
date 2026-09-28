import {
  type Draft,
  placeOfGroup,
  type WindowTab,
} from "@/client/atoms/orchestrator";

import { computerTabOf } from "./file-tabs";
import { isFreshTab, parseHref } from "./window-tabs";

/**
 * What stands behind a draft now, when it is something other than what the
 * draft was opened over and the person has not left it out: the tab the
 * window has up, while it is in view. It goes with the message as well, so
 * a draft written while looking at something else carries both.
 */
export function behindTabOf(
  draft: Draft,
  active: undefined | WindowTab,
  isShown: boolean,
): undefined | WindowTab {
  if (!active || !isShown || !isIncludable(active)) {
    return;
  }
  if (
    draft.included?.tabId === active.id ||
    draft.leftBehind?.includes(active.id)
  ) {
    return;
  }
  return active;
}

/**
 * Whether a group's tab is in view in the window: a place always shows its
 * tab up, and a chat shows one only while its pane is open beside it.
 */
export function isGroupShown(
  group: string | undefined,
  paneOpenByGroup: Record<string, boolean>,
): boolean {
  if (group === undefined) {
    return false;
  }
  return placeOfGroup(group) !== undefined || paneOpenByGroup[group] === true;
}

/**
 * Whether a tab is something a message can carry to the conversation: a
 * page, a file or folder on the computer, or an app's front. A place's own
 * fresh tab is the place rather than a thing in it, and the screens with no
 * words for the conversation are left out.
 */
export function isIncludable(tab: WindowTab): boolean {
  if (isFreshTab(tab)) {
    return false;
  }
  if (tab.kind === "page") {
    return true;
  }
  return (
    computerTabOf(tab.href) !== undefined ||
    parseHref(tab.href).pathname.startsWith("/orchestrator/apps/")
  );
}
