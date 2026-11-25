import { typedPathOf } from "@/client/lib/typed-path";
import { describe, expect, it } from "vitest";

import { boxOpens, boxPageRows, siteToComplete } from "./new-tab-box";

const visited = [
  {
    favicon: undefined,
    title: "Pull requests",
    url: "https://github.com/acme/app/pulls",
    visitCount: 1,
  },
  {
    favicon: undefined,
    title: "Issues",
    url: "https://github.com/acme/app/issues",
    visitCount: 1,
  },
  {
    favicon: undefined,
    title: "Hacker News",
    url: "https://news.ycombinator.com/",
    visitCount: 1,
  },
];

/** What Return does with the words, as the box reads them on a Mac with `visited` as its history. */
function returnDoes(words: string, isSiteFinished = false) {
  const path = typedPathOf(words, "darwin");
  const site = isSiteFinished ? siteToComplete(words, visited) : undefined;
  const opens = boxOpens({ completedSite: site?.url, path, words });
  if (opens === undefined) {
    return "sends";
  }
  if (opens.kind === "path") {
    return `opens path ${opens.path.shown}`;
  }
  if (opens.kind === "site") {
    return `opens ${opens.url}`;
  }
  return `opens ${opens.address.kind === "page" ? opens.address.url : opens.address.address}`;
}

describe("what Return does in a new tab's box", () => {
  it.each([
    ["words", "compare these two plans", "sends"],
    ["one word that is no address", "pricing", "sends"],
    ["a link among words", "read https://example.com for me", "sends"],
    ["two lines", "example.com\nplease", "sends"],
    ["an address and a space", "example.com ", "sends"],
    ["an address in doubt", "node.js", "sends"],
    ["a scheme alone", "ftp://", "sends"],
    ["a slash command", "/proj", "sends"],
    ["an address alone", "example.com", "opens https://example.com/"],
    [
      "an address pasted whole",
      "https://example.com/pricing?plan=team",
      "opens https://example.com/pricing?plan=team",
    ],
    [
      "a path alone",
      "/Users/mac-user/notes.md",
      "opens path /Users/mac-user/notes.md",
    ],
    [
      "a path with an escaped space",
      "/Users/mac-user/My\\ Notes.md",
      "opens path /Users/mac-user/My Notes.md",
    ],
    ["a path and words after it", "/Users/mac-user/foo why is this", "sends"],
  ])("%s: %j %s", (_what, words, does) => {
    expect(returnDoes(words)).toBe(does);
  });

  it("opens the site the box finished one word to", () => {
    expect(returnDoes("git", true)).toBe("opens https://github.com/");
  });

  it("sends one word the box finished to no site", () => {
    expect(returnDoes("hack", true)).toBe("sends");
  });
});

describe("the rest of a site's address a new tab's box writes in", () => {
  // Newest first, as history and the bookmarks give them.
  const pages = [
    { title: "Examples", url: "https://examples.org/" },
    { title: "Pull requests", url: "https://github.com/acme/app/pulls" },
    { title: "Example Domain", url: "https://www.example.com/" },
    { title: "Old wiki", url: "http://wiki.acme.test/" },
  ];

  it.each([
    [
      "the newest site the word starts",
      "examp",
      "les.org",
      "https://examples.org/",
    ],
    [
      "a site past where two sites part",
      "example.",
      "com",
      "https://www.example.com/",
    ],
    ["a site visited by a page on it", "git", "hub.com", "https://github.com/"],
    ["a site typed with www.", "www.exa", "mples.org", "https://examples.org/"],
    ["a site on http", "wik", "i.acme.test", "http://wiki.acme.test/"],
    ["words in another case", "GIT", "hub.com", "https://github.com/"],
  ])("finishes %s: %j", (_what, words, rest, url) => {
    expect(siteToComplete(words, pages)).toEqual({ rest, url });
  });

  it.each([
    ["words that start no site", "zzz"],
    ["words that reach past the site into a page on it", "github.com/acme"],
    ["words with a space", "git hub"],
    ["a slash command", "/git"],
    ["a site written out whole", "github.com"],
  ])("is nothing for %s: %j", (_what, words) => {
    expect(siteToComplete(words, pages)).toBeUndefined();
  });
});

describe("the pages under a new tab's box", () => {
  const pages = [
    ...visited.map(({ title, url }) => ({ favicon: undefined, title, url })),
    {
      favicon: undefined,
      title: "https://docs.example.com/guide",
      url: "https://docs.example.com/guide",
    },
    {
      favicon: undefined,
      title: "Sign in",
      url: "https://accounts.google.com/signin?continue=https%3A%2F%2Fmail.google.com%2F",
    },
    {
      favicon: undefined,
      title: "",
      url: "http://localhost:5173/settings/http-cache",
    },
    {
      favicon: undefined,
      title: "Help desk pricing",
      url: "https://www.zendesk.com/pricing/",
    },
    {
      favicon: undefined,
      title: "Weekly report",
      url: "https://notion.so/acme/Weekly-report-1a2b",
    },
    {
      favicon: undefined,
      title: "Explore GitHub",
      url: "https://github.com/explore",
    },
  ];
  /** A row as a person reads it, the bold letters in brackets. */
  const marked = (text: string, ranges: null | number[]) => {
    let out = "";
    let at = 0;
    for (let index = 0; ranges && index + 1 < ranges.length; index += 2) {
      const start = ranges[index] ?? 0;
      const end = ranges[index + 1] ?? 0;
      out += `${text.slice(at, start)}[${text.slice(start, end)}]`;
      at = end;
    }
    return out + text.slice(at);
  };
  const rowsFor = (words: string, completedSite?: string) =>
    boxPageRows({
      completedSite,
      pages,
      path: typedPathOf(words, "darwin"),
      words,
    }).map((row) =>
      [
        row.kind,
        row.title === "" ? undefined : marked(row.title, row.titleRanges),
        marked(row.address, row.addressRanges),
      ]
        .filter(Boolean)
        .join(" · "),
    );

  it("finds pages only where a word of their site, title or path starts, and says where", () => {
    const words = [
      "http",
      "https",
      "www",
      "https://",
      "com",
      "h",
      "ht",
      "hack",
      "ycomb",
      "acker",
      "hub",
      "a2b",
      "pricing",
      "report",
      "settings",
      "github.com/acme/app/p",
      "https://git",
      "git hub",
      "/proj",
      "/Users/mac-user/notes.md",
      "",
    ];
    expect(
      Object.fromEntries(words.map((word) => [word, rowsFor(word)])),
    ).toMatchInlineSnapshot(`
      {
        "": [],
        "/Users/mac-user/notes.md": [],
        "/proj": [],
        "a2b": [],
        "acker": [],
        "com": [],
        "git hub": [],
        "github.com/acme/app/p": [
          "page · Pull requests · [github.com/acme/app/p]ulls",
        ],
        "h": [
          "page · [H]acker News · news.ycombinator.com",
          "page · [H]elp desk pricing · zendesk.com/pricing",
          "page · localhost:5173/settings/[h]ttp-cache",
        ],
        "hack": [
          "page · [Hack]er News · news.ycombinator.com",
        ],
        "ht": [
          "page · localhost:5173/settings/[ht]tp-cache",
        ],
        "http": [],
        "https": [],
        "https://": [],
        "https://git": [
          "page · Pull requests · [git]hub.com/acme/app/pulls",
          "page · Issues · [git]hub.com/acme/app/issues",
          "page · Explore [Git]Hub · [git]hub.com/explore",
        ],
        "hub": [],
        "pricing": [
          "page · Help desk [pricing] · zendesk.com/[pricing]",
        ],
        "report": [
          "page · Weekly [report] · notion.so/acme/Weekly-[report]-1a2b",
        ],
        "settings": [
          "page · localhost:5173/[settings]/http-cache",
        ],
        "www": [],
        "ycomb": [
          "page · Hacker News · news.[ycomb]inator.com",
        ],
      }
    `);
  });

  it("puts the site the box finished the word to first, once", () => {
    expect(rowsFor("git", "https://github.com/")).toMatchInlineSnapshot(`
      [
        "site · [git]hub.com",
        "page · Pull requests · [git]hub.com/acme/app/pulls",
        "page · Issues · [git]hub.com/acme/app/issues",
        "page · Explore [Git]Hub · [git]hub.com/explore",
      ]
    `);
  });

  it("lists at most four", () => {
    const many = Array.from({ length: 6 }, (_, at) => ({
      favicon: undefined,
      title: `Docs ${at}`,
      url: `https://docs${at}.test/`,
    }));
    expect(
      boxPageRows({ pages: many, path: undefined, words: "docs" }),
    ).toHaveLength(4);
  });
});
