import {
  type ChosenItem,
  type Draft,
  type WindowTab,
} from "@/client/atoms/window";
import { hostPathOfFileUrl } from "@/client/lib/file-url";
import { type TabId } from "@/shared/tabs";

import { groupOfHref } from "./app-tabs";
import { computerTabOf } from "./file-tabs";
import { joinHostPath } from "./host-path";
import { isFreshTab } from "./tab-model";
import { chatOfGroup, parseHref } from "./window-href";

/**
 * What stands behind a draft now, when it is something other than what the
 * draft was opened over and the person has not left it out: what the window
 * has in view. It goes with the message as well, so a draft written while
 * looking at something else carries both.
 */
export function behindTabOf(
  draft: Draft,
  inView: undefined | WindowTab,
): undefined | WindowTab {
  if (!inView || !isIncludable(inView)) {
    return;
  }
  if (
    includedIdOf(draft) === inView.id ||
    draft.leftBehind?.includes(inView.id)
  ) {
    return;
  }
  return inView;
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
 * a tab of a chat's or a site's, while it is among the window's tabs, or
 * one of the window's own tabs, at wherever it stands now while that is a
 * screen of its own rather than a chat or a site.
 */
export function includedTabOf(
  draft: Draft,
  allTabs: WindowTab[],
  hrefOfAppTab: (id: TabId) => string | undefined,
): undefined | WindowTab {
  const { included } = draft;
  if (!included) {
    return;
  }
  if ("appTabId" in included) {
    const href = hrefOfAppTab(included.appTabId);
    return href === undefined || groupOfHref(href) !== undefined
      ? undefined
      : screenTabAt(href, included.appTabId);
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
  return chatOfGroup(group) === undefined || paneOpenByGroup[group] === true;
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
    parseHref(tab.href).pathname.startsWith("/apps/")
  );
}

/**
 * What the window has in view: the tab up in the group the window's tab
 * stands on, while that group shows it, or else the screen the window's own
 * tab stands on, as a tab by that tab's id.
 */
export function tabInView({
  activeHref,
  appTabId,
  groupTab,
  isGroupTabShown,
}: {
  activeHref: string;
  appTabId: TabId;
  groupTab: undefined | WindowTab;
  isGroupTabShown: boolean;
}): undefined | WindowTab {
  if (groupOfHref(activeHref) !== undefined) {
    return isGroupTabShown ? groupTab : undefined;
  }
  return screenTabAt(activeHref, appTabId);
}

/** The id of the tab the draft was opened over, whichever kind of tab it is. */
function includedIdOf(draft: Draft): string | undefined {
  const { included } = draft;
  if (!included) {
    return;
  }
  return "appTabId" in included ? included.appTabId : included.tabId;
}

/**
 * One of the window's own tabs standing on a screen of its own, as a tab for
 * the chips and the readers that take one: a folder or file on the computer,
 * or an app's front.
 */
function screenTabAt(
  href: string,
  id: string,
): Extract<WindowTab, { kind: "screen" }> {
  return { href, id, kind: "screen" };
}

function withoutSlash(path: string) {
  return path.length > 1 ? path.replace(/[/\\]+$/, "") : path;
}
