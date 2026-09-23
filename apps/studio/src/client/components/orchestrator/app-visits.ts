import { type VisitedPage } from "@/client/atoms/orchestrator";

/**
 * Whether a page is on an app's site: on the site's own host, or on one
 * under it, since a service's signed-in app lives at `app.asana.com` while
 * the directory names it `asana.com`. Never a host that merely ends in the
 * same letters.
 */
export function isOnSite(pageUrl: string, site: string): boolean {
  const page = hostOf(pageUrl);
  const host = hostOf(site);
  if (page === undefined || host === undefined) {
    return false;
  }
  return page === host || page.endsWith(`.${host}`);
}

/**
 * The pages visited on the apps' sites, in the order they were visited,
 * newest first, each with the app it is on. An app's site is where the
 * directory says it is and where its signed-in app opens, which are not
 * always one domain: Notion is `notion.so` in the directory and
 * `app.notion.com` once signed in. A page on two apps' sites is the first
 * app's, so one page is one row.
 */
export function visitsWithin<
  App extends { home?: string | undefined; site?: string | undefined },
>(
  visited: readonly VisitedPage[],
  apps: readonly App[],
): { app: App; page: VisitedPage }[] {
  return visited.flatMap((page) => {
    const app = apps.find((candidate) =>
      [candidate.site, candidate.home].some(
        (site) => site !== undefined && isOnSite(page.url, site),
      ),
    );
    return app ? [{ app, page }] : [];
  });
}

/** The host an address is on, without a leading `www.`; nothing for words that are not an address. */
function hostOf(url: string): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  return new URL(url).hostname.replace(/^www\./, "") || undefined;
}
