import {
  type HistoryPage,
  removeFromHistory,
} from "@/client/hooks/use-browser-history";
import { RelativeTime } from "@/client/components/relative-time";
import { PageFavicon } from "@/client/components/favicon";

import { PageContextMenu, usePageClicks } from "./page-menu";
import { PageTooltip } from "./page-tooltip";

/**
 * Pages visited lately, as rows: each the page's mark, drawn the way its
 * tab and a chip draw it, with the page's title and address. A
 * row opens the page in this tab; the middle button, a Cmd-click and the
 * menu ask for a tab of its own, waiting behind, the way every link in the
 * window does, and the menu takes a page off the list.
 */
export function VisitedPageRows({
  hasHost = false,
  isCompact = false,
  onOpen,
  visits,
}: {
  /** Whether a compact entry names its page's site, for a list of many sites. */
  hasHost?: boolean;
  /**
   * As a grid of entries showing the title and relative visit time.
   * The whole title and address are available on hover.
   */
  isCompact?: boolean;
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
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,20rem),1fr))] gap-x-2 gap-y-2">
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
                  className="flex min-h-16 w-full min-w-0 items-center gap-2.5 rounded-lg bg-accent/60 px-3 py-2.5 text-left hover:bg-accent data-[state=open]:bg-accent dark:hover:bg-white/8 dark:data-[state=open]:bg-white/8"
                  {...clicksFor(page.url, onOpen)}
                  type="button"
                >
                  <PageFavicon
                    favicon={page.favicon}
                    hasTooltip={false}
                    url={page.url}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">
                      {page.title || shownAddress(page.url)}
                    </span>
                    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                      {hasHost && (
                        <>
                          <span className="truncate">
                            {URL.parse(page.url)?.hostname.replace(
                              /^www\./,
                              "",
                            ) || page.url}
                          </span>
                          <span aria-hidden>·</span>
                        </>
                      )}
                      <RelativeTime
                        className="shrink-0"
                        date={new Date(page.at)}
                        tooltip={false}
                      />
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
export function shownAddress(url: string): string {
  if (!URL.canParse(url)) {
    return url;
  }
  const parsed = new URL(url);
  const path = parsed.pathname === "/" ? "" : parsed.pathname;
  return `${parsed.host}${path}${parsed.search}`.replace(/\/$/, "");
}
