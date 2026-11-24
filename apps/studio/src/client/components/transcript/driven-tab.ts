import { type WindowTab } from "@/client/atoms/window";

type PageTab = Extract<WindowTab, { kind: "page" }>;

/** The page tabs among `tabs`. */
export const pagesOf = (tabs: readonly WindowTab[]) =>
  tabs.filter((tab): tab is PageTab => tab.kind === "page");

/**
 * The page tab in `tabs` a session sent its latest command, by when it last
 * acted in each (`lastAtOf`, 0 for never), whichever group holds it. A group
 * is not a chat's, and a copy of a page (a duplicated group's) is a tab of its
 * own that the session has not acted in, so only where the session acted
 * picks the tab.
 */
export function drivenTabOf(
  tabs: readonly WindowTab[],
  lastAtOf: (tab: PageTab) => number,
): PageTab | undefined {
  let newest: PageTab | undefined;
  let newestAt = 0;
  for (const tab of pagesOf(tabs)) {
    const at = lastAtOf(tab);
    if (at > newestAt) {
      newest = tab;
      newestAt = at;
    }
  }
  return newest;
}

/**
 * Whether a page card stays out of sight: the page it would picture is up
 * beside its transcript, or no tab is known to be the one the session is on.
 * A tab it last drove before the turn's first browser call may not be, nor is
 * an earlier one once the tab it drove last has closed, so the card waits for
 * its next command to reach a page.
 */
export function isPageCardAway({
  beside,
  driven,
  since,
}: {
  /** The tab up on the other side of the group from the transcript. */
  beside: string | undefined;
  /** The tab the session sent its latest command, of those open, and when. */
  driven: { at: number; id: string } | undefined;
  /** The turn's first browser call, or the session's latest command in any tab, closed or not, whichever is later, in ms. */
  since: number;
}): boolean {
  return driven === undefined || driven.id === beside || driven.at < since;
}
