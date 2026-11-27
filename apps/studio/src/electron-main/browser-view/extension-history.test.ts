import { describe, expect, it } from "vitest";

import {
  chromeTransition,
  HistoryQuerySchema,
  searchHistory,
  searchRange,
  toVisitItem,
} from "./extension-history";
import { type HistoryTransition, type PersonPage } from "./history-store";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function page(id: number, url: string, title: string): PersonPage {
  return {
    id,
    lastVisit: NOW - id * HOUR,
    title,
    typedCount: id % 2,
    url,
    visitCount: id,
  };
}

const PAGES = [
  page(1, "https://news.example.com/today", "Today's News"),
  page(2, "https://docs.example.com/guide", "Getting Started Guide"),
  page(3, "https://shop.test/cart", "Your Cart"),
];

describe("chromeTransition", () => {
  it.each<[HistoryTransition, HistoryTransition | undefined, string]>([
    ["typed", undefined, "typed"],
    ["link", undefined, "link"],
    ["back_forward", "typed", "typed"],
    ["back_forward", "link", "link"],
    ["back_forward", undefined, "link"],
  ])("reads %s, stepped from %s, as %s", (transition, steppedFrom, chrome) => {
    expect(chromeTransition(transition, steppedFrom)).toBe(chrome);
  });
});

describe("searchHistory", () => {
  it("matches every word in the address or title, latest first, up to the limit", () => {
    const cases = {
      "0 for every one": { maxResults: 0, text: "" },
      "a limit": { maxResults: 2, text: "" },
      "a query that is not one": "nonsense",
      "a word in the address": { text: "SHOP" },
      "a word in the title, any case": { text: "guide" },
      "empty text": { text: "" },
      "every word has to match": { text: "example news" },
      "no text": {},
      "words that match apart": { text: "news cart" },
    };
    expect(
      Object.fromEntries(
        Object.entries(cases).map(([name, query]) => [
          name,
          searchHistory(PAGES, HistoryQuerySchema.parse(query))
            .map((item) => item.url)
            .join(" "),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "0 for every one": "https://news.example.com/today https://docs.example.com/guide https://shop.test/cart",
        "a limit": "https://news.example.com/today https://docs.example.com/guide",
        "a query that is not one": "https://news.example.com/today https://docs.example.com/guide https://shop.test/cart",
        "a word in the address": "https://shop.test/cart",
        "a word in the title, any case": "https://docs.example.com/guide",
        "empty text": "https://news.example.com/today https://docs.example.com/guide https://shop.test/cart",
        "every word has to match": "https://news.example.com/today",
        "no text": "https://news.example.com/today https://docs.example.com/guide https://shop.test/cart",
        "words that match apart": "",
      }
    `);
  });

  it("answers Chrome's HistoryItem", () => {
    expect(searchHistory(PAGES.slice(0, 1), HistoryQuerySchema.parse({})))
      .toMatchInlineSnapshot(`
      [
        {
          "id": "1",
          "lastVisitTime": 1795777200000,
          "title": "Today's News",
          "typedCount": 1,
          "url": "https://news.example.com/today",
          "visitCount": 1,
        },
      ]
    `);
  });
});

describe("searchRange", () => {
  it.each([
    [
      "nothing named: the last 24 hours, with no end",
      {},
      { before: "no end", since: "2026-11-26T12:00:00.000Z" },
    ],
    [
      "a start and an end",
      { endTime: NOW - HOUR, startTime: NOW - 3 * HOUR },
      {
        before: "2026-11-27T11:00:00.000Z",
        since: "2026-11-27T09:00:00.000Z",
      },
    ],
    [
      "dates a structured clone kept",
      { endTime: new Date(NOW), startTime: new Date(NOW - 2 * HOUR) },
      {
        before: "2026-11-27T12:00:00.000Z",
        since: "2026-11-27T10:00:00.000Z",
      },
    ],
  ])("%s", (_name, query, expected) => {
    const { before, since } = searchRange(HistoryQuerySchema.parse(query), NOW);
    expect({
      before:
        before === Number.MAX_SAFE_INTEGER
          ? "no end"
          : new Date(before).toISOString(),
      since: new Date(since).toISOString(),
    }).toEqual(expected);
  });
});

describe("toVisitItem", () => {
  it("answers Chrome's VisitItem, naming no referrer as 0", () => {
    expect([
      toVisitItem({ at: NOW, id: 12, transition: "typed", urlId: 3 }),
      toVisitItem({
        at: NOW + 1000,
        fromVisit: 12,
        id: 13,
        steppedFrom: "typed",
        transition: "back_forward",
        urlId: 3,
      }),
    ]).toMatchInlineSnapshot(`
      [
        {
          "id": "3",
          "isLocal": true,
          "referringVisitId": "0",
          "transition": "typed",
          "visitId": "12",
          "visitTime": 1795780800000,
        },
        {
          "id": "3",
          "isLocal": true,
          "referringVisitId": "12",
          "transition": "typed",
          "visitId": "13",
          "visitTime": 1795780801000,
        },
      ]
    `);
  });
});
