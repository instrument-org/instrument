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
  const pages = visited.map(({ title, url }) => ({
    favicon: undefined,
    title,
    url,
  }));
  const rowsFor = (words: string, completedSite?: string) =>
    boxPageRows({
      completedSite,
      pages,
      path: typedPathOf(words, "darwin"),
      words,
    }).map((row) => `${row.kind} ${row.page.url}`);

  it.each([
    [
      "the finished site, then the pages its address starts",
      "git",
      "https://github.com/",
      [
        "site https://github.com/",
        "page https://github.com/acme/app/pulls",
        "page https://github.com/acme/app/issues",
      ],
    ],
    [
      "a page whose title has a word the word starts",
      "hack",
      undefined,
      ["page https://news.ycombinator.com/"],
    ],
    [
      "a page whose address has a word the word starts",
      "ycomb",
      undefined,
      ["page https://news.ycombinator.com/"],
    ],
    ["nothing for letters inside a word", "acker", undefined, []],
    ["nothing for words with a space", "git hub", undefined, []],
    ["nothing for a slash command", "/proj", undefined, []],
    ["nothing for a path", "/Users/mac-user/notes.md", undefined, []],
    ["nothing for an empty box", "", undefined, []],
  ])("%s: %j", (_what, words, completedSite, rows) => {
    expect(rowsFor(words, completedSite)).toEqual(rows);
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
