import {
  type AppCatalogEntry,
  catalogEntryFinder,
  getAppCatalog,
} from "./catalog";

/** A page the person visited in the in-app browser, or an origin keeping site data there, and when it was last used where that is known. */
export interface UsedAddress {
  address: string;
  /** Epoch ms. */
  at?: number;
}

/** Whether an entry is reached only through the Mac's own app, which no site stands for, even where the directory names its maker's. */
function isMacAppOnly(entry: AppCatalogEntry): boolean {
  return (
    entry.interfaces.length > 0 &&
    entry.interfaces.every((surface) => surface.format === "mac-app")
  );
}

/** The hosts an entry names as its own: its domain and its web app's. */
function ownHosts(entry: AppCatalogEntry): string[] {
  const home = entry.home === undefined ? undefined : URL.parse(entry.home);
  return [entry.domain, ...(home ? [home.hostname] : [])];
}

/**
 * Finds the entry a host sits under: the one whose own host it is below, the
 * nearest winning (`console.cloud.shop.com` is Shop Cloud's at
 * `cloud.shop.com`, not Shop's at `shop.com`), and none where two are as
 * near. Never the reverse: `amazon.com` is under no entry of `aws.amazon.com`.
 */
function entryAboveFinder(
  entries: readonly AppCatalogEntry[],
): (host: string) => AppCatalogEntry | undefined {
  const owners = new Map<string, Set<AppCatalogEntry>>();
  for (const entry of entries) {
    for (const own of ownHosts(entry)) {
      owners.set(own, (owners.get(own) ?? new Set()).add(entry));
    }
  }
  return (host) => {
    // The hosts above it, nearest first.
    for (
      let dot = host.indexOf(".");
      dot !== -1;
      dot = host.indexOf(".", dot + 1)
    ) {
      const nearest = owners.get(host.slice(dot + 1));
      if (nearest !== undefined) {
        return nearest.size === 1 ? [...nearest][0] : undefined;
      }
    }
    return undefined;
  };
}

/**
 * The directory's services the person uses in the in-app browser, most
 * recently used first, each with the host it was used on: an address is a
 * service's where `catalogEntryAt` finds one (its web app, or the one entry
 * on its host), or else where it sits under one entry's own host. A site
 * many services share (`google.com`) answers none of them, a service reached
 * only through a Mac app has no site to be used on, and the directory's
 * hidden entries (documentation servers and the like) are left out, as its
 * listing leaves them.
 */
export function catalogEntriesFromBrowser(
  used: readonly UsedAddress[],
  catalog: readonly AppCatalogEntry[] = getAppCatalog(),
): { host: string; slug: string }[] {
  const entries = catalog.filter(
    (entry) => entry.tier !== "hidden" && !isMacAppOnly(entry),
  );
  // The directory is read once, so a page costs a lookup by its host.
  const entryAt = catalogEntryFinder(entries);
  const entryAbove = entryAboveFinder(entries);
  const found = new Map<string, { at: number; host: string }>();
  for (const { address, at = 0 } of used) {
    const url = URL.parse(address);
    if (!url?.hostname) {
      continue;
    }
    const entry = entryAt(url) ?? entryAbove(url.hostname);
    const seen = entry === undefined ? undefined : found.get(entry.slug);
    if (entry !== undefined && (seen === undefined || at > seen.at)) {
      found.set(entry.slug, { at, host: url.hostname });
    }
  }
  return [...found]
    .toSorted(([, a], [, b]) => b.at - a.at)
    .map(([slug, { host }]) => ({ host, slug }));
}
