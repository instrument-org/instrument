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
 * beside its transcript, or it is not yet known which page that is. Until a
 * browser call of the turn's has ended, a tab the session last drove before
 * its first may not be the one it is on, so the card waits rather than coming
 * up for a page about to appear beside it.
 */
export function isPageCardAway({
  beside,
  driven,
  hasEndedCall,
  isReading,
  startedAt,
}: {
  /** The tab up on the other side of the group from the transcript. */
  beside: string | undefined;
  /** The tab the session sent its latest command, and when. */
  driven: { at: number; id: string } | undefined;
  hasEndedCall: boolean;
  /** Which tab it drove is still being read. */
  isReading: boolean;
  /** When the turn's first browser call came, in ms. */
  startedAt: number;
}): boolean {
  if (driven === undefined) {
    return isReading || !hasEndedCall;
  }
  return driven.id === beside || (!hasEndedCall && driven.at < startedAt);
}
