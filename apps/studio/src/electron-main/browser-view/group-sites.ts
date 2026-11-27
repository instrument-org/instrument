import type {
  BrowserSite,
  UsedAddress,
} from "@instrument-org/workspace/electron";
import { getDomain } from "tldts";

/** Where a site keeps data in the browser profile besides its cookies. */
type SiteDataKind = BrowserSite["siteData"][number];

/** What the browser profile, its history and the workspace's apps say, before it is grouped by site. */
export interface SiteReads {
  /** The workspace's own apps, by the address each reaches. */
  apps: { slug: string; url: string }[];
  /** Cookies by the host they were set for, a domain cookie's with its leading dot. */
  cookies: { count: number; host: string }[];
  /** Origins keeping site data, and where. */
  siteData: { kind: SiteDataKind; origin: string }[];
  /** Pages visited, by address and who visited them: how often and when last. */
  visits: readonly {
    actor: "agent" | "user";
    at: number;
    count: number;
    url: string;
  }[];
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
 * The reads grouped by site: each site's cookies, its visits by the user and
 * by agents and when the user last visited it, the data it keeps, its hosts
 * visited or keeping data, and the workspace's apps whose own address is on
 * it. A site with only an app on it has no row. When a cookie was last sent
 * is no sign the user used its site, since it goes with every page that
 * embeds the site.
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
  for (const { count, host } of reads.cookies) {
    if (host.replace(/^\./, "") === "") {
      continue;
    }
    rowOf(host).cookies += count;
  }
  for (const { actor, at, count, url } of reads.visits) {
    const host = URL.parse(url)?.hostname;
    if (!host) {
      continue;
    }
    const row = rowOf(host);
    row.visits[actor] += count;
    row.hostSet.add(host);
    if (actor === "user" && (row.usedAt === undefined || at > row.usedAt)) {
      row.usedAt = at;
    }
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

/**
 * What the user used in the in-app browser, for the directory's services
 * the Apps page offers from it: the pages they visited, each with when last,
 * and the origins keeping site data, save on a site only agents visited:
 * agents browse in the same profile, so that data is their work. Data on a
 * site with no visits at all stays.
 */
export function usedByUser({
  siteData,
  visits,
}: Pick<SiteReads, "siteData" | "visits">): UsedAddress[] {
  const siteOf = (address: string) => {
    const host = URL.parse(address)?.hostname;
    return host ? siteOfHost(host) : undefined;
  };
  const visitedBy = { agent: new Set<string>(), user: new Set<string>() };
  for (const { actor, url } of visits) {
    const site = siteOf(url);
    if (site !== undefined) {
      visitedBy[actor].add(site);
    }
  }
  return [
    ...visits
      .filter(({ actor }) => actor === "user")
      .map(({ at, url }) => ({ address: url, at })),
    ...siteData.flatMap(({ origin }) => {
      const site = siteOf(origin);
      return site !== undefined &&
        visitedBy.agent.has(site) &&
        !visitedBy.user.has(site)
        ? []
        : [{ address: origin }];
    }),
  ];
}
