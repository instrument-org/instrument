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
 * newest first, each with the app it is on. A page on two apps' sites is the
 * first app's, so one page is one row.
 */
export function visitsWithin<
  Page extends { url: string },
  App extends { site?: string | undefined },
>(visited: readonly Page[], apps: readonly App[]): { app: App; page: Page }[] {
  return visited.flatMap((page) => {
    const app = apps.find(
      (candidate) =>
        candidate.site !== undefined && isOnSite(page.url, candidate.site),
    );
    return app ? [{ app, page }] : [];
  });
}

/** An app the workspace has, by the sites its pages are on. */
export interface SiteApp {
  icon?: string | undefined;
  name: string;
  site: string | undefined;
  /** The addresses its pages are on: its own site and its signed-in web app. */
  sites: readonly string[];
  slug: string;
}

/**
 * The app a page is on the site of: the one whose site names the page's host
 * most exactly, so a page in Google Drive is Drive's and not Google's, and
 * the first listed where two name it the same.
 */
export function appOfPage(
  url: string,
  apps: readonly SiteApp[],
): SiteApp | undefined {
  let best: { app: SiteApp; length: number } | undefined;
  for (const app of apps) {
    for (const site of app.sites) {
      if (isOnSite(url, site)) {
        const { length } = new URL(site).hostname.replace(/^www\./, "");
        if (best === undefined || length > best.length) {
          best = { app, length };
        }
      }
    }
  }
  return best?.app;
}

/** The host an address is on, without a leading `www.`; nothing for words that are not an address. */
function hostOf(url: string): string | undefined {
  if (!URL.canParse(url)) {
    return undefined;
  }
  return new URL(url).hostname.replace(/^www\./, "") || undefined;
}
