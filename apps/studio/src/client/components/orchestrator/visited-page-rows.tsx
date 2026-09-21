import { type VisitedPage } from "@/client/atoms/orchestrator";
import { RelativeTime } from "@/client/components/relative-time";
import { useGesturesFor } from "@/client/hooks/use-open-target";

import { AppIcon } from "./app-icon";

/**
 * Pages visited lately, as rows: each the mark of the app it is on, the
 * page's title with its address quiet under it, and when it was last open.
 * A row opens the page in this tab; the middle button and the menu ask for
 * a tab of its own, the way every link in the window does.
 */
export function VisitedPageRows({
  onOpen,
  visits,
}: {
  onOpen: (url: string) => void;
  visits: {
    app: { name: string; site?: string | undefined };
    page: VisitedPage;
  }[];
}) {
  const gesturesFor = useGesturesFor();
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
              <AppIcon name={app.name} site={app.site} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium">
                  {page.title || shownAddress(page.url)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {shownAddress(page.url)}
                </span>
              </span>
              <RelativeTime
                className="shrink-0 text-xs text-muted-foreground"
                compact
                date={new Date(page.at)}
                tooltip={false}
              />
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
