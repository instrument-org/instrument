import { expect, it } from "vitest";

import { historyToRestore } from "./guest-history";

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
