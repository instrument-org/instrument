import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

import type { HistoryPage } from "./history-store";

const DAY_MS = 24 * 60 * 60 * 1000;
const RECENT_LIMIT = 12;
const HOST_LIMIT = 2;
const FREQUENT_LIMIT = 6;

/** The browser start's selections over existing history; nothing is written. */
export function readStartPages(
  database: DatabaseSync,
  excludedUrls: readonly string[],
  now: number,
): { frequent: HistoryPage[]; recent: HistoryPage[] } {
  const excluded = new Set(excludedUrls);
  const recent: HistoryPage[] = [];
  const hostCounts = new Map<string, number>();
  // Iterate past a crowded host until the list is full or history runs out.
  const pages = database.prepare(
    "SELECT url, title, favicon, last_visit, visit_count, typed_count FROM urls WHERE hidden = 0 ORDER BY last_visit DESC, url ASC",
  );
  for (const row of pages.iterate()) {
    const page = pageOf(row);
    const host = hostnameOf(page.url);
    if (excluded.has(page.url) || !host) {
      continue;
    }
    const count = hostCounts.get(host) ?? 0;
    if (count >= HOST_LIMIT) {
      continue;
    }
    recent.push(page);
    hostCounts.set(host, count + 1);
    if (recent.length === RECENT_LIMIT) {
      break;
    }
  }

  // Group visits by URL and local calendar day before combining hostnames:
  // distinct days must count once even when several pages share a host.
  const days = database.prepare(`
    SELECT urls.url, urls.title, urls.favicon, urls.visit_count, urls.typed_count,
      date(visits.at / 1000, 'unixepoch', 'localtime') AS day,
      max(visits.at) AS last_visit, max(visits.transition = 'typed') AS explicit
    FROM visits JOIN urls ON urls.id = visits.url_id
    WHERE visits.actor = 'user' AND visits.hidden_by IS NULL
      AND visits.at >= ? AND visits.at <= ?
    GROUP BY urls.id, day
  `);
  const hosts = new Map<
    string,
    {
      days: Set<string>;
      explicitDays: Set<string>;
      at: number;
      pages: Map<string, RankedPage>;
    }
  >();
  for (const row of days.iterate(now - 30 * DAY_MS, now)) {
    const page = pageOf(row);
    const host = hostnameOf(page.url);
    if (excluded.has(page.url) || !host) {
      continue;
    }
    const site = hosts.get(host) ?? {
      at: page.at,
      days: new Set<string>(),
      explicitDays: new Set<string>(),
      pages: new Map<string, RankedPage>(),
    };
    const destination = site.pages.get(page.url) ?? {
      days: new Set<string>(),
      explicitDays: new Set<string>(),
      page,
    };
    const day = String(row.day);
    site.days.add(day);
    destination.days.add(day);
    if (Number(row.explicit) > 0) {
      site.explicitDays.add(day);
      destination.explicitDays.add(day);
    }
    site.at = Math.max(site.at, page.at);
    if (page.at > destination.page.at) {
      destination.page = page;
    }
    site.pages.set(page.url, destination);
    hosts.set(host, site);
  }
  const frequent = [...hosts.entries()]
    .filter(([, site]) => site.days.size >= 2)
    .toSorted(
      ([hostA, a], [hostB, b]) =>
        b.days.size - a.days.size ||
        b.explicitDays.size - a.explicitDays.size ||
        b.at - a.at ||
        hostA.localeCompare(hostB),
    )
    .slice(0, FREQUENT_LIMIT)
    .flatMap(([, site]) => {
      const [best] = [...site.pages.values()].toSorted(
        (a, b) =>
          b.days.size - a.days.size ||
          b.explicitDays.size - a.explicitDays.size ||
          b.page.at - a.page.at ||
          a.page.url.localeCompare(b.page.url),
      );
      return best ? [best.page] : [];
    });
  return { frequent, recent };
}

type RankedPage = {
  days: Set<string>;
  explicitDays: Set<string>;
  page: HistoryPage;
};

function pageOf(row: Record<string, SQLOutputValue>): HistoryPage {
  return {
    at: Number(row.last_visit),
    ...(typeof row.favicon === "string" ? { favicon: row.favicon } : {}),
    title: String(row.title),
    typedCount: Number(row.typed_count),
    url: String(row.url),
    visitCount: Number(row.visit_count),
  };
}

function hostnameOf(url: string) {
  const parsed = URL.parse(url);
  return parsed?.protocol === "http:" || parsed?.protocol === "https:"
    ? parsed.hostname.replace(/^www\./, "")
    : undefined;
}
