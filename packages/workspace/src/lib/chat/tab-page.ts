import { type BrowserConfig, type BrowserTargetId } from "../../types";

/** The window's titles for the tabs whose pages are up. */
export async function liveTabTitles(
  browser: Pick<BrowserConfig, "listTargets">,
): Promise<Map<BrowserTargetId, string>> {
  const targets = await browser.listTargets();
  return new Map(targets.map(({ id, title }) => [id, title]));
}

/**
 * The page a tab is on, for telling and recording: from its live page, else
 * from the window's list, for a tab whose page was unloaded.
 */
export function tabPage(
  browser: Pick<BrowserConfig, "getTargetAddress">,
  id: BrowserTargetId,
  {
    listed,
    titles,
  }: {
    listed: { title?: string; url?: string } | undefined;
    titles: ReadonlyMap<BrowserTargetId, string>;
  },
): { title: string | undefined; url: string | undefined } {
  return {
    title: titles.get(id) ?? listed?.title,
    url: browser.getTargetAddress(id) ?? listed?.url,
  };
}
