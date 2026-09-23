import { type VisitedPage } from "@/client/atoms/orchestrator";
import { useGesturesFor } from "@/client/hooks/use-open-target";
import { cn } from "@/client/lib/utils";

import { AppIcon } from "./app-icon";

/**
 * Pages visited lately, as rows: each the mark of the app it is on in a
 * small tile, the page's title with its address quiet under it, and nothing
 * else: no time, no count. A row opens the page in this tab; the middle
 * button and the menu ask for a tab of its own, the way every link in the
 * window does.
 */
export function VisitedPageRows({
  isCompact = false,
  isOneRow = false,
  onOpen,
  visits,
}: {
  /**
   * As a dense grid of one-line entries, as many columns as the width
   * holds: the page's title, then its address, quiet, on the same line.
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
  const gesturesFor = useGesturesFor();
  if (isCompact) {
    return (
      <ul
        className={cn(
          "grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-x-2",
          // Rows past the first take no height, and the list clips them.
          isOneRow && "auto-rows-[0] grid-rows-[auto] overflow-hidden",
        )}
      >
        {visits.map(({ app, page }) => {
          const gestures = gesturesFor({ kind: "page", url: page.url });
          return (
            <li className="min-w-0" key={page.url}>
              <button
                className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-accent/60"
                onAuxClick={gestures.onAuxClick}
                onClick={() => {
                  onOpen(page.url);
                }}
                onContextMenu={gestures.onContextMenu}
                title={page.url}
                type="button"
              >
                <AppIcon name={app.name} site={app.site} size="sm" />
                {/* The title keeps its room; the address takes what is left and
                    gives it up first, so only one of the two is ever cut. */}
                <span className="min-w-0 shrink truncate text-[13px]">
                  {page.title || shownAddress(page.url)}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {shownAddress(page.url)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card shadow-xs">
      {visits.map(({ app, page }) => {
        const gestures = gesturesFor({ kind: "page", url: page.url });
        return (
          <li key={page.url}>
            <button
              className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40"
              onAuxClick={gestures.onAuxClick}
              onClick={() => {
                onOpen(page.url);
              }}
              onContextMenu={gestures.onContextMenu}
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
          </li>
        );
      })}
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
