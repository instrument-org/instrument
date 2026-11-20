import { type WindowTab } from "@/client/atoms/window";
import { type Draft } from "@/shared/drafts";
import { instrumentLinkOf } from "@instrument-org/shared";

import { type BrowserTabsHandle } from "./browser-tabs";

/**
 * The web pages a draft names by their address that no tab of its band
 * shows, which its chat opens at the send (`pageToChat`). A page the band
 * has open, from the plus, goes with the band's tabs instead.
 */
export function pagesForChat(
  draft: Draft,
  band: readonly WindowTab[],
): string[] {
  const shown = new Set(
    band.flatMap((tab) => (tab.kind === "page" && tab.url ? [tab.url] : [])),
  );
  return (draft.context ?? []).flatMap((entry) =>
    entry.kind === "link" &&
    instrumentLinkOf(entry.url) === undefined &&
    !shown.has(entry.url)
      ? [entry.url]
      : [],
  );
}

/**
 * How a page a draft names reaches its chat at the send: by its address, as
 * a new tab right after the chat's own, waiting there behind it. The
 * person's own tab showing it stays where it is. Sign-ins come along, since
 * every tab shares one browser session; what was typed into the person's
 * page and where it was scrolled to do not.
 */
export function pageToChat({
  browser,
  chatTab,
  url,
}: {
  browser: Pick<BrowserTabsHandle, "openBehind"> | null;
  /** The chat's tab, which the page opens right after. */
  chatTab: { group: string; id: string };
  url: string;
}): void {
  browser?.openBehind(url, { after: chatTab.id, group: chatTab.group });
}
