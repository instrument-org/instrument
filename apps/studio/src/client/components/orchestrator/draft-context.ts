import {
  type ChosenItem,
  type Draft,
  type WindowTab,
} from "@/client/atoms/orchestrator";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { StoreId } from "@instrument-org/workspace/client";

import { computerTabOf } from "./file-tabs";
import { joinHostPath } from "./host-path";
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
    (draft.included !== undefined &&
      "tabId" in draft.included &&
      draft.included.tabId === active.id) ||
    draft.leftBehind?.includes(active.id)
  ) {
    return;
  }
  return active;
}

/**
 * What a tab a draft was opened over points at on this computer, less what
 * the draft already holds by name: what is selected in the Finder on screen,
 * or its folder when nothing else is; a file tab's file; a folder tab's
 * folder. Nothing on this computer, for a web page or an app, which the chip
 * names as itself; empty when everything it points at is already held.
 */
export function includedItemsOf(
  tab: WindowTab,
  finder: null | { folder: string; selected: ChosenItem[] },
  chosen: ChosenItem[],
): ChosenItem[] | undefined {
  const held = new Set(chosen.map((item) => withoutSlash(item.path)));
  const unheld = (items: ChosenItem[]) =>
    items.filter((item) => !held.has(withoutSlash(item.path)));
  if (tab.kind === "page") {
    const file = hostPathOfFileUrl(tab.url);
    return file === undefined
      ? undefined
      : unheld([{ kind: "file", path: file }]);
  }
  const computer = computerTabOf(tab.href);
  if (!computer) {
    return;
  }
  if (computer.file !== undefined) {
    return unheld([{ kind: "file", path: computer.file }]);
  }
  if (finder) {
    const selected = unheld(finder.selected);
    return selected.length > 0
      ? selected
      : unheld([{ kind: "folder", path: finder.folder }]);
  }
  // A root the address names by a word (home, the recents) is not a path.
  return /^(?:\/|[A-Z]:)/i.test(computer.root)
    ? unheld([
        { kind: "folder", path: joinHostPath(computer.root, computer.path) },
      ])
    : undefined;
}

/**
 * The thing a draft was opened over, while it is still there to point at:
 * a tab of the place the window stood in, while it is among the window's
 * tabs, or a screen the window's own tab stood on, as the address it had.
 */
export function includedTabOf(
  draft: Draft,
  allTabs: WindowTab[],
): undefined | WindowTab {
  const { included } = draft;
  if (!included) {
    return;
  }
  if ("href" in included) {
    return screenTabAt(included.href);
  }
  return allTabs.find(
    (tab) => tab.id === included.tabId && tab.group === included.group,
  );
}

/**
 * Whether a group's tab is in view in the window: a site opened at the
 * window's level always shows its page, and a chat shows its tab up only
 * while its pane is open beside it.
 */
export function isGroupShown(
  group: string | undefined,
  paneOpenByGroup: Record<string, boolean>,
): boolean {
  if (group === undefined) {
    return false;
  }
  return (
    !StoreId.SessionSchema.safeParse(group).success ||
    paneOpenByGroup[group] === true
  );
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

/**
 * A screen of the window's own, standing on no place's tab, as a tab for the
 * chips and the readers that take one: a folder or file on the computer, or
 * an app's front.
 */
export function screenTabAt(
  href: string,
): Extract<WindowTab, { kind: "screen" }> {
  return { href, id: `screen:${href}`, kind: "screen" };
}

function withoutSlash(path: string) {
  return path.length > 1 ? path.replace(/[/\\]+$/, "") : path;
}
