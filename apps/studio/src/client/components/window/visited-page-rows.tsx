import {
  type HistoryPage,
  removeFromHistory,
} from "@/client/hooks/use-browser-history";
import { PageFavicon } from "@/client/components/favicon";
import { cn } from "@/client/lib/utils";

import { PageContextMenu, usePageClicks } from "./page-menu";
import { PageTooltip } from "./page-tooltip";

/**
 * Pages visited lately, as rows: each the page's mark, drawn the way its
 * tab and a chip draw it, and the page's title, and nothing else: no time,
 * no count. A
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
   * holds: the page's title alone, with the whole title and its address
   * on hover.
   */
  isCompact?: boolean;
  /** Only as many as fit on one row, for a strip under a page's head. */
  isOneRow?: boolean;
  onOpen: (url: string) => void;
  visits: { page: HistoryPage }[];
}) {
  const clicksFor = usePageClicks();
  const menuFor = (url: string) => ({
    onOpen,
    onRemove: () => {
      removeFromHistory(url);
    },
    removeLabel: "Remove from Recent Pages",
    url,
  });
  if (isCompact) {
    return (
      <ul
        className={cn(
          "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-2",
          // Rows past the first take no height, and the list clips them;
          // a gap between rows would still be counted under the one shown.
          isOneRow
            ? "auto-rows-[0] grid-rows-[auto] overflow-hidden"
            : "gap-y-2",
        )}
      >
        {visits.map(({ page }) => (
          <li className="min-w-0" key={page.url}>
            <PageContextMenu {...menuFor(page.url)}>
              <PageTooltip title={page.title} url={page.url}>
                {/* Each page on a tint of its own, so the list reads as things
                  to press rather than as text; under the pointer, a step
                  further from the page's ground. Dark's accent is a faint
                  white, too close to its own tint to read as a step, so
                  the step there is drawn outright. */}
                <button
                  className="flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg bg-accent/60 px-2.5 text-left hover:bg-accent data-[state=open]:bg-accent dark:hover:bg-white/8 dark:data-[state=open]:bg-white/8"
                  {...clicksFor(page.url, onOpen)}
                  type="button"
                >
                  <PageFavicon
                    favicon={page.favicon}
                    hasTooltip={false}
                    url={page.url}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {page.title || shownAddress(page.url)}
                  </span>
                </button>
              </PageTooltip>
            </PageContextMenu>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      {visits.map(({ page }) => (
        <li key={page.url}>
          <PageContextMenu {...menuFor(page.url)}>
            <PageTooltip title={page.title} url={page.url}>
              <button
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40 data-[state=open]:bg-accent/40"
                {...clicksFor(page.url, onOpen)}
                type="button"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                  <PageFavicon
                    favicon={page.favicon}
                    hasTooltip={false}
                    url={page.url}
                  />
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
            </PageTooltip>
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
