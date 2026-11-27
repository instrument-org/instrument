import type { BrowserSite } from "@instrument-org/workspace/electron";
import { getDomain } from "tldts";

/** Where a site keeps data in the browser profile besides its cookies. */
type SiteDataKind = BrowserSite["siteData"][number];

/** What the browser profile, its history and the workspace's apps say, before it is grouped by site. */
export interface SiteReads {
  /** The workspace's own apps, by the address each reaches. */
  apps: { slug: string; url: string }[];
  /** Cookies by the host they were set for, a domain cookie's with its leading dot, and when one was last sent. */
  cookies: { count: number; host: string; usedAt?: number }[];
  /** Origins keeping site data, and where. */
  siteData: { kind: SiteDataKind; origin: string }[];
  /** Pages visited, by address and who visited them: how often and when last. */
  visits: { actor: "agent" | "user"; at: number; count: number; url: string }[];
}

/**
 * The site a host is on: its registrable domain (`google.com` for
 * `mail.google.com`, `someone.github.io` for itself), or the host itself
 * where it has none (`localhost`, an IP address).
 */
function siteOfHost(host: string): string {
  const bare = host.replace(/^\./, "");
  return getDomain(bare, { allowPrivateDomains: true }) ?? bare;
}

/**
 * The origin an IndexedDB folder of a Chromium profile is named for:
 * `https_www.example.com_0.indexeddb.leveldb` is `https://www.example.com`,
 * a port other than 0 kept. Nothing for any other folder.
 */
export function indexedDbOrigin(folder: string): string | undefined {
  const named = /^(https?)_(.+)_(\d+)\.indexeddb\.(?:blob|leveldb)$/.exec(
    folder,
  );
  const [, scheme, host, port] = named ?? [];
  if (scheme === undefined || host === undefined || port === undefined) {
    return undefined;
  }
  return `${scheme}://${host}${port === "0" ? "" : `:${port}`}`;
}

/**
 * The origin a Local Storage key of a Chromium profile is the record of
 * (`META:https://example.com`), when it is a site's own: a key a frame
 * keeps under another site's page (`…^0https://other.com`) is that page's
 * business, not a sign the site was used.
 */
export function localStorageOrigin(key: string): string | undefined {
  const origin = key.slice("META:".length);
  return /^https?:\/\/[^/^]+$/.test(origin) ? origin : undefined;
}

/**
 * The reads grouped by site: each site's cookies and when they were last
 * sent, its visits by the user and by agents, the data it keeps, its hosts
 * visited or keeping data, and the workspace's apps whose own address is on
 * it. A site with only an app on it has no row.
 */
export function groupSites(reads: SiteReads): BrowserSite[] {
  const rows = new Map<
    string,
    BrowserSite & { hostSet: Set<string>; kinds: Set<SiteDataKind> }
  >();
  const rowOf = (host: string) => {
    const site = siteOfHost(host);
    let row = rows.get(site);
    if (row === undefined) {
      row = {
        cookies: 0,
        hostSet: new Set(),
        hosts: [],
        kinds: new Set(),
        setUpAs: [],
        site,
        siteData: [],
        visits: { agent: 0, user: 0 },
      };
      rows.set(site, row);
    }
    return row;
  };
  const used = (row: BrowserSite, at: number | undefined) => {
    if (at !== undefined && (row.usedAt === undefined || at > row.usedAt)) {
      row.usedAt = at;
    }
  };
  for (const { count, host, usedAt } of reads.cookies) {
    if (host.replace(/^\./, "") === "") {
      continue;
    }
    const row = rowOf(host);
    row.cookies += count;
    used(row, usedAt);
  }
  for (const { actor, at, count, url } of reads.visits) {
    const host = URL.parse(url)?.hostname;
    if (!host) {
      continue;
    }
    const row = rowOf(host);
    row.visits[actor] += count;
    row.hostSet.add(host);
    used(row, at);
  }
  for (const { kind, origin } of reads.siteData) {
    const host = URL.parse(origin)?.hostname;
    if (!host) {
      continue;
    }
    const row = rowOf(host);
    row.kinds.add(kind);
    row.hostSet.add(host);
  }
  for (const { slug, url } of reads.apps) {
    const host = URL.parse(url)?.hostname;
    const row = host ? rows.get(siteOfHost(host)) : undefined;
    row?.setUpAs.push(slug);
  }
  return [...rows.values()].map(({ hostSet, kinds, ...row }) => ({
    ...row,
    hosts: [...hostSet].toSorted(),
    setUpAs: row.setUpAs.toSorted(),
    siteData: (["IndexedDB", "Local Storage"] as const).filter((kind) =>
      kinds.has(kind),
    ),
  }));
}
