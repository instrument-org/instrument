import { describe, expect, it } from "vitest";

import {
  allTimeNote,
  cacheDetail,
  clearedMessage,
  cookiesDetail,
  historyDetail,
  sinceOf,
  TIME_RANGES,
} from "./browsing-data";

const NOW = Date.UTC(2026, 9, 9, 12);

describe("browsing data", () => {
  it("starts each range that far before now, and all time nowhere", () => {
    expect(
      TIME_RANGES.map(({ id }) => {
        const since = sinceOf(id, NOW);
        return `${id}: ${since === undefined ? "all time" : new Date(since).toISOString()}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "hour: 2026-10-09T11:00:00.000Z",
        "day: 2026-10-08T12:00:00.000Z",
        "week: 2026-10-02T12:00:00.000Z",
        "fourWeeks: 2026-09-11T12:00:00.000Z",
        "all: all time",
      ]
    `);
  });

  it("names the first site of the history in range and counts the rest", () => {
    expect(
      [
        { count: 0, hosts: [] },
        { count: 3, hosts: ["google.com"] },
        { count: 9, hosts: ["google.com", "github.com"] },
        { count: 40, hosts: ["google.com", "github.com", "nytimes.com"] },
      ].map(historyDetail),
    ).toMatchInlineSnapshot(`
      [
        "There’s no history from this time.",
        "From google.com.",
        "From google.com and 1 more site.",
        "From google.com and 2 more sites.",
      ]
    `);
  });

  it("counts the sites holding cookies", () => {
    expect(
      [[], ["google.com"], ["google.com", "github.com", "x.com"]].map(
        cookiesDetail,
      ),
    ).toMatchInlineSnapshot(`
      [
        "No sites have saved any yet.",
        "From 1 site. This signs you out of it.",
        "From 3 sites. This signs you out of most of them.",
      ]
    `);
  });

  it("says how much clearing the cache frees", () => {
    expect([0, 200_000, 4_400_000, 52_000_000, 3_200_000_000].map(cacheDetail))
      .toMatchInlineSnapshot(`
      [
        "Nothing is cached right now.",
        "Frees up less than 1 MB. Some sites may load more slowly the next time you visit.",
        "Frees up 4.2 MB. Some sites may load more slowly the next time you visit.",
        "Frees up 50 MB. Some sites may load more slowly the next time you visit.",
        "Frees up 3.0 GB. Some sites may load more slowly the next time you visit.",
      ]
    `);
  });

  it("says when what is picked can only go from all time", () => {
    expect(
      (
        [
          { cache: true, range: "hour", siteData: true },
          { cache: false, range: "day", siteData: true },
          { cache: true, range: "week", siteData: false },
          { cache: false, range: "week", siteData: false },
          { cache: true, range: "all", siteData: true },
        ] as const
      ).map(allTimeNote),
    ).toMatchInlineSnapshot(`
      [
        "Cookies, site data, and cached files are cleared from all time, whatever range you pick.",
        "Cookies and site data are cleared from all time, whatever range you pick.",
        "Cached files are cleared from all time, whatever range you pick.",
        null,
        null,
      ]
    `);
  });

  it("says what was cleared in one sentence", () => {
    expect(
      (
        [
          { cache: false, history: true, range: "hour", siteData: false },
          { cache: true, history: true, range: "week", siteData: true },
          { cache: true, history: false, range: "all", siteData: true },
          { cache: true, history: true, range: "all", siteData: false },
        ] as const
      ).map(clearedMessage),
    ).toMatchInlineSnapshot(`
      [
        "Cleared your history from the last hour.",
        "Cleared your history from the last 7 days, cookies, site data, and cached files.",
        "Cleared cookies, site data, and cached files.",
        "Cleared your history and cached files.",
      ]
    `);
  });
});
