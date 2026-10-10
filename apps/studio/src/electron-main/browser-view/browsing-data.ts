import { getBrowserSessionDir } from "@instrument-org/workspace/electron";
import { type Cookie, type Session } from "electron";
import { getDomain } from "tldts";

import { configureGuestSession } from "./guest-session";

/** The in-app browser's session, opened if no page has opened it yet this run. */
function browserSession(): Session {
  return configureGuestSession(getBrowserSessionDir());
}

/**
 * Every storage a site keeps in the browser besides the HTTP cache, which is
 * what "cookies and other site data" means in a browser's own clearing
 * dialog.
 */
const SITE_STORAGES = [
  "cachestorage",
  "cookies",
  "filesystem",
  "indexdb",
  "localstorage",
  "serviceworkers",
] as const;

/**
 * The sites holding cookies, each named once by its registrable domain
 * (`accounts.google.com` and `.google.com` are both `google.com`), most
 * cookies first.
 */
export function cookieSitesOf(cookies: Pick<Cookie, "domain">[]): string[] {
  const counts = new Map<string, number>();
  for (const { domain } of cookies) {
    const host = (domain ?? "").replace(/^\./, "");
    if (!host) {
      continue;
    }
    const site = getDomain(host, { allowPrivateDomains: true }) ?? host;
    counts.set(site, (counts.get(site) ?? 0) + 1);
  }
  return [...counts]
    .toSorted(
      ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b),
    )
    .map(([site]) => site);
}

/** What the browser holds that the clearing dialog can say something about. */
export async function browsingDataSummary(): Promise<{
  cacheBytes: number;
  cookieSites: string[];
}> {
  const ses = browserSession();
  const [cacheBytes, cookies] = await Promise.all([
    ses.getCacheSize(),
    ses.cookies.get({}),
  ]);
  return { cacheBytes, cookieSites: cookieSitesOf(cookies) };
}

/**
 * Clears what was asked of the browser's session, from all time: Chromium
 * keeps no record of when a cookie, a site's storage, or a cached file was
 * written that Electron lets anything ask about, so neither takes a range.
 */
export async function clearBrowsingData({
  cache,
  siteData,
}: {
  cache: boolean;
  siteData: boolean;
}): Promise<void> {
  const ses = browserSession();
  if (siteData) {
    await ses.clearStorageData({ storages: [...SITE_STORAGES] });
    // Cookies and storage are written to disk lazily; flush so a quit right
    // after does not bring back what was just cleared.
    await ses.cookies.flushStore();
  }
  if (cache) {
    await ses.clearCache();
    await ses.clearCodeCaches({});
  }
}
