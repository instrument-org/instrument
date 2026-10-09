const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** How far back clearing reaches, in the order a browser's own dialog offers. */
export const TIME_RANGES = [
  {
    id: "hour",
    label: "Last hour",
    phrase: "from the last hour",
    spanMs: HOUR_MS,
  },
  {
    id: "day",
    label: "Last 24 hours",
    phrase: "from the last 24 hours",
    spanMs: DAY_MS,
  },
  {
    id: "week",
    label: "Last 7 days",
    phrase: "from the last 7 days",
    spanMs: 7 * DAY_MS,
  },
  {
    id: "fourWeeks",
    label: "Last 4 weeks",
    phrase: "from the last 4 weeks",
    spanMs: 28 * DAY_MS,
  },
  { id: "all", label: "All time", phrase: null, spanMs: null },
] as const;

export type TimeRangeId = (typeof TIME_RANGES)[number]["id"];

function timeRangeOf(id: TimeRangeId) {
  return TIME_RANGES.find((range) => range.id === id) ?? TIME_RANGES[0];
}

/** The epoch ms a range starts at, or nothing for all time. */
export function sinceOf(id: TimeRangeId, now: number): number | undefined {
  const { spanMs } = timeRangeOf(id);
  return spanMs === null ? undefined : now - spanMs;
}

/** "3 sites", "1 site". */
function sites(count: number) {
  return `${count} ${count === 1 ? "site" : "sites"}`;
}

/** "3 more sites", "1 more site". */
function moreSites(count: number) {
  return `${count} more ${count === 1 ? "site" : "sites"}`;
}

/**
 * Where the history in range came from, the way a browser says it: the
 * first site by name and how many more there are.
 */
export function historyDetail({
  count,
  hosts,
}: {
  count: number;
  hosts: string[];
}): string {
  const [first] = hosts;
  if (count === 0 || first === undefined) {
    return "There’s no history from this time.";
  }
  if (hosts.length === 1) {
    return `From ${first}.`;
  }
  return `From ${first} and ${moreSites(hosts.length - 1)}.`;
}

export function cookiesDetail(cookieSites: string[]): string {
  if (cookieSites.length === 0) {
    return "No sites have saved any yet.";
  }
  return cookieSites.length === 1
    ? "From 1 site. This signs you out of it."
    : `From ${sites(cookieSites.length)}. This signs you out of most of them.`;
}

/** "12 MB", "1.4 GB", or "less than 1 MB". */
function formatCacheSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  if (mb < 1) {
    return "less than 1 MB";
  }
  if (mb < 1024) {
    return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
  }
  return `${(mb / 1024).toFixed(1)} GB`;
}

export function cacheDetail(bytes: number): string {
  if (bytes === 0) {
    return "Nothing is cached right now.";
  }
  return `Frees up ${formatCacheSize(bytes)}. Some sites may load more slowly the next time you visit.`;
}

/**
 * Said under the boxes when a range short of all time is picked along with
 * what can only be cleared from all time; nothing otherwise.
 */
export function allTimeNote({
  cache,
  range,
  siteData,
}: {
  cache: boolean;
  range: TimeRangeId;
  siteData: boolean;
}): null | string {
  if (range === "all" || (!cache && !siteData)) {
    return null;
  }
  const what =
    cache && siteData
      ? "Cookies, site data, and cached files are"
      : siteData
        ? "Cookies and site data are"
        : "Cached files are";
  return `${what} cleared from all time, whatever range you pick.`;
}

/** The toast after clearing: what went, as one sentence. */
export function clearedMessage({
  cache,
  history,
  range,
  siteData,
}: {
  cache: boolean;
  history: boolean;
  range: TimeRangeId;
  siteData: boolean;
}): string {
  const { phrase } = timeRangeOf(range);
  const parts = [
    ...(history ? [phrase ? `your history ${phrase}` : "your history"] : []),
    ...(siteData ? ["cookies", "site data"] : []),
    ...(cache ? ["cached files"] : []),
  ];
  return `Cleared ${new Intl.ListFormat("en", { type: "conjunction" }).format(parts)}.`;
}
