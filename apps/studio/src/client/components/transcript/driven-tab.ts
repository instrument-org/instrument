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
