import {
  type BrowserSite,
  getBrowserSessionDir,
  listApps,
} from "@instrument-org/workspace/electron";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  groupSites,
  indexedDbOrigin,
  localStorageOrigin,
  type SiteReads,
} from "./group-sites";
import { configureGuestSession } from "./guest-session";
import { getHistoryStore } from "./history-store";
import { levelDbKeys } from "./leveldb-keys";
import { log } from "./log";

/** Milliseconds from 1601, where Chromium counts its times from, to 1970. */
const CHROMIUM_EPOCH_MS = 11_644_473_600_000;

/**
 * The browser's cookies counted by the host each was set for, expired ones
 * left out, with when one of them was last sent: read from the profile's
 * `Cookies` database once the session has written out what it holds, and
 * never a cookie's name or value. Where the database can't be opened
 * (another process holding it locked), the session's own list, which says
 * nothing of when.
 */
async function cookieCounts(profileDir: string): Promise<SiteReads["cookies"]> {
  const session = configureGuestSession(profileDir);
  await session.cookies.flushStore();
  try {
    const database = new DatabaseSync(path.join(profileDir, "Cookies"), {
      readOnly: true,
    });
    try {
      // Chromium's times are microseconds since 1601, more than a number
      // holds exactly, so the query makes them milliseconds.
      return database
        .prepare(
          "SELECT host_key AS host, count(*) AS count, max(last_access_utc) / 1000 AS used FROM cookies WHERE has_expires = 0 OR expires_utc / 1000 > ? GROUP BY host_key",
        )
        .all(Date.now() + CHROMIUM_EPOCH_MS)
        .map((row) => {
          const used = Number(row.used);
          return {
            count: Number(row.count),
            host: String(row.host),
            ...(used > 0 ? { usedAt: used - CHROMIUM_EPOCH_MS } : {}),
          };
        });
    } finally {
      database.close();
    }
  } catch (error) {
    log.warn("Counted cookies from the session, not its database", error);
    const counts = new Map<string, number>();
    for (const { domain } of await session.cookies.get({})) {
      if (domain) {
        counts.set(domain, (counts.get(domain) ?? 0) + 1);
      }
    }
    return [...counts].map(([host, count]) => ({ count, host }));
  }
}

/** The origins keeping data in the profile: its IndexedDB folders, and its Local Storage records. */
async function siteDataOrigins(
  profileDir: string,
): Promise<SiteReads["siteData"]> {
  const [folders, keys] = await Promise.all([
    // A profile no page has kept a database in yet has no folder.
    fs.promises
      .readdir(path.join(profileDir, "IndexedDB"))
      .catch((): string[] => []),
    levelDbKeys(path.join(profileDir, "Local Storage", "leveldb"), "META:"),
  ]);
  return [
    ...folders.flatMap((folder) => {
      const origin = indexedDbOrigin(folder);
      return origin === undefined
        ? []
        : [{ kind: "IndexedDB" as const, origin }];
    }),
    ...keys.flatMap((key) => {
      const origin = localStorageOrigin(key);
      return origin === undefined
        ? []
        : [{ kind: "Local Storage" as const, origin }];
    }),
  ];
}

/** The workspace's own apps by the address each reaches; a server that runs here reaches none. */
async function appAddresses(): Promise<SiteReads["apps"]> {
  const { apps } = await listApps();
  return apps.flatMap(({ manifest, slug }) =>
    manifest.type === "mcp-local" ? [] : [{ slug, url: manifest.url }],
  );
}

/**
 * Every site the in-app browser has cookies, site data or visits for, as
 * `window sites` lists them (`readBrowserSites` on the workspace's config).
 * Read when asked, never kept.
 */
export async function browserSites(): Promise<BrowserSite[]> {
  const profileDir = getBrowserSessionDir();
  const [cookies, apps, siteData] = await Promise.all([
    cookieCounts(profileDir),
    appAddresses(),
    siteDataOrigins(profileDir),
  ]);
  return groupSites({
    apps,
    cookies,
    siteData,
    visits: getHistoryStore().visitedPages(),
  });
}

