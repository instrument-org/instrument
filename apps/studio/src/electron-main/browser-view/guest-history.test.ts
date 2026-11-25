import { expect, it } from "vitest";

import { historyStandingOn, historyToRestore } from "./guest-history";

const page = (url: string) => ({ title: url, url });

it.each([
  { entries: [], index: 0, want: null },
  { entries: ["about:blank"], index: 0, want: null },
  {
    entries: ["about:blank", "https://a", "https://b"],
    index: 2,
    want: { behind: ["https://a"], url: "https://b" },
  },
  {
    entries: ["about:blank", "https://a", "about:blank", "https://b"],
    index: 1,
    want: { behind: [], url: "https://a" },
  },
  {
    entries: ["https://a", "https://b", "https://c"],
    index: 1,
    want: { behind: ["https://a"], url: "https://b" },
  },
])(
  "keeps a guest's page and those behind it, from $entries at $index",
  ({ entries, index, want }) => {
    const restored = historyToRestore(entries.map(page), index);
    expect(
      restored && {
        behind: restored.behind.map(({ url }) => url),
        url: restored.url,
      },
    ).toEqual(want);
  },
);

const FILE = "file:///Users/mac-user/a%20b.html";
it.each([
  {
    entries: ["about:blank", "file:///x.html", `${FILE}#part`, "https://a"],
    index: 3,
    want: { index: 1, urls: ["file:///x.html", `${FILE}#part`] },
  },
  {
    entries: [FILE, "https://a", "https://b"],
    index: 2,
    want: { index: 0, urls: [FILE] },
  },
  {
    entries: ["https://a", "file:///Users/mac-user/a b.html"],
    index: 1,
    want: { index: 1, urls: ["https://a", "file:///Users/mac-user/a b.html"] },
  },
  { entries: ["https://a"], index: 0, want: null },
  { entries: ["https://a", FILE], index: 0, want: null },
])(
  "stands on the file it left, from $entries at $index",
  ({ entries, index, want }) => {
    const kept = historyStandingOn(entries.map(page), index, FILE);
    expect(
      kept && { index: kept.index, urls: kept.entries.map(({ url }) => url) },
    ).toEqual(want);
  },
);
