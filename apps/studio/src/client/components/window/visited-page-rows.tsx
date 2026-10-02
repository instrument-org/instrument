import { type VisitedPage, visitedPagesAtom } from "@/client/atoms/window";
import { cn } from "@/client/lib/utils";
import { useSetAtom } from "jotai";

import { AppIcon } from "./app-icon";
import { PageContextMenu, usePageClicks } from "./page-menu";

/**
 * Pages visited lately, as rows: each the mark of the app it is on in a
 * small tile and the page's title, and nothing else: no time, no count. A
 * row opens the page in this tab; the middle button, a Cmd-click and the
 * menu ask for a tab of its own, waiting behind, the way every link in the
 * window does, and the menu takes a page off the list.
 */
export function VisitedPageRows({
  isCompact = false,
  isOneRow = false,
  onOpen,
  visits,
}: {
  /**
   * As a dense grid of one-line entries, as many columns as the width
   * holds: the page's title alone, with its address in the tooltip.
   */
  isCompact?: boolean;
  /** Only as many as fit on one row, for a strip under a page's head. */
  isOneRow?: boolean;
  onOpen: (url: string) => void;
  visits: {
    app: { name: string; site?: string | undefined };
    page: VisitedPage;
  }[];
}) {
  const clicksFor = usePageClicks();
  const setVisited = useSetAtom(visitedPagesAtom);
  const menuFor = (url: string) => ({
    onOpen,
    onRemove: () => {
      setVisited((current) => current.filter((page) => page.url !== url));
    },
    removeLabel: "Remove from Recent Pages",
    url,
  });
  if (isCompact) {
    return (
      <ul
        className={cn(
          "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-2",
          // Rows past the first take no height, and the list clips them.
          isOneRow && "auto-rows-[0] grid-rows-[auto] overflow-hidden",
        )}
      >
        {visits.map(({ app, page }) => (
          <li className="min-w-0" key={page.url}>
            <PageContextMenu {...menuFor(page.url)}>
              <button
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-accent/60 data-[state=open]:bg-accent/60"
                {...clicksFor(page.url, onOpen)}
                // The title has the row; where it is on the web is a hover
                // away rather than a second column cutting it short.
                title={shownAddress(page.url)}
                type="button"
              >
                <AppIcon name={app.name} site={app.site} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {page.title || shownAddress(page.url)}
                </span>
              </button>
            </PageContextMenu>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      {visits.map(({ app, page }) => (
        <li key={page.url}>
          <PageContextMenu {...menuFor(page.url)}>
            <button
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40 data-[state=open]:bg-accent/40"
              {...clicksFor(page.url, onOpen)}
              type="button"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                <AppIcon name={app.name} site={app.site} size="sm" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">
                  {page.title || shownAddress(page.url)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {shownAddress(page.url)}
                </span>
              </span>
            </button>
          </PageContextMenu>
        </li>
      ))}
    </ul>
  );
}

/** An address as a person reads it: the host and the path, no scheme, no trailing slash. */
function shownAddress(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.host}${path}${parsed.search}`.replace(/\/$/, "");
}
